# 微信支付真实接入（APIv3 JSAPI + 退款）

状态：待确认
范围：服务端微信支付适配、小程序支付调起、后台配置项、契约与部署联调

## 1. 目标

把现有 `PaymentProvider` / `RefundProvider` 抽象从 mock 扩展到真实微信支付：

- 小程序 JSAPI 下单：服务端调用 `POST /v3/pay/transactions/jsapi`，返回小程序可直接调起的支付参数。
- 支付回调：服务端验签（`Wechatpay-Signature`）、AES-256-GCM 解密 `resource`、金额校验、幂等推进订单。
- 退款：后台售后审核通过后调用 `POST /v3/refund/domestic/refunds`，沿用现有退款单号幂等逻辑。
- 后台集成配置补齐微信支付公钥模式所需字段，避免新商户（公钥模式）无法验签。
- 部署到 `https://car.aition.art`，以「查询订单」接口验证商户签名链路，再切 `provider=wechat` 由真机完成真实支付。**不发起真实退款。**

非目标：

- 不实现 H5/公众号支付（本项目只有小程序端）。
- 不实现退款结果回调路由（退款状态以同步接口返回为准，`PROCESSING` 时保留待处理，由后台重新执行确认）。
- 不实现微信支付公钥自动下载（公钥模式由后台上传公钥文件 + 公钥 ID）。

## 2. 现状（已确认）

- [payment.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/payment/payment.service.ts)：`provider()` 在 `wechat` 时直接抛 503；`pay()` 未传 openid；回调幂等与金额校验逻辑已具备。
- [payment.provider.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/payment/payment.provider.ts)：`PaymentParams` 只有 mock 参数，需要增加小程序支付参数。
- [payment.controller.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/payment/payment.controller.ts)：回调使用 `JSON.stringify(req.body)` 重建报文，无法验签；需改用原始报文。
- [main.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/main.ts)：`NestFactory.create(AppModule, { bodyParser: true })`，需改 `rawBody: true`。
- [aftersale.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/aftersale/aftersale.service.ts#L26)：退款渠道固定为 `MockRefundProvider`。
- [integration.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/integration/integration.service.ts)：已有 `wechatPayMchId / wechatPayCertSerial / wechatPayNotifyUrl / wechatPayApiV3KeyFile / wechatPayPrivateKeyFile`，无公钥模式字段，无读取密钥文件的出口方法。
- Prisma `IntegrationConfig`（schema.prisma#L488）无公钥字段；`Refund` 状态仅有 `PENDING/SUCCESS/FAILED`。
- 小程序三处支付入口仍是「下单 → mock/confirm」固定流程：
  - `apps/miniapp/src/pages/checkout/index.tsx`
  - `apps/miniapp/src/pages/order-detail/index.tsx`
  - `apps/miniapp/src/pages/orders/index.tsx`
- 服务端已具备：AppID `wx04619aa796c2188f`、商户号 `1716944776`、证书序列号 `7BC09B93B0DACE88AC3C112E939E1596E2F2F216`；本地已有 APIv3 密钥文件与 `apiclient_key.pem`；服务器 DB 尚未上传这两个密钥文件。

## 3. 设计

### 3.1 新增文件

`apps/api/src/modules/payment/wechat/wechat-pay.config.ts`

```ts
export interface WechatPayConfig {
  appId: string;            // 小程序 AppID
  mchId: string;
  certSerial: string;       // 商户 API 证书序列号
  notifyUrl: string;        // https://car.aition.art/api/payments/callback
  apiV3Key: string;         // 32 位
  privateKeyPem: string;    // 商户 API 私钥（PEM）
  publicKeyId?: string;     // 微信支付公钥 ID（PUB_KEY_ID_...，可选）
  publicKeyPem?: string;    // 微信支付公钥（可选）
}
```

`apps/api/src/modules/payment/wechat/wechat-pay.client.ts`

职责与关键方法：

- `constructor(config: WechatPayConfig)`，使用 `node:crypto`，不引入第三方 SDK。
- `private authorization(method, path, body)`：`WECHATPAY2-SHA256-RSA2048` 签名。
  报文：`method\npath\ntimestamp\nnonce\nbody\n`，`RSA-SHA256`，`serial_no=config.certSerial`。
- `private async request<T>(method, path, payload?)`：
  - 请求 `https://api.mch.weixin.qq.com`；
  - 非 2xx 抛 `BadGatewayException`，携带微信 `code/message`；
  - 若响应带 `wechatpay-signature`，尝试用 `resolveWechatPublicKey(wechatpay-serial)` 验签，验签失败抛错；
  - `/v3/certificates` 自身响应跳过验签（证书尚未缓存）。
- `async createJsapiPayment(input: {outTradeNo, description, amountCents, openid})`：
  - `POST /v3/pay/transactions/jsapi`，`amount: { total, currency: 'CNY' }`、`payer: { openid }`、`notify_url`；
  - 返回 `{ prepayId, payParams: { timeStamp, nonceStr, package, signType: 'RSA', paySign } }`。
- `async refund(input: {refundNo, outTradeNo?, transactionId?, amountCents, totalCents, reason?})`：
  - `POST /v3/refund/domestic/refunds`，优先 `transaction_id`，否则 `out_trade_no`；
  - 返回 `{ refundId, status }`。
- `async verifyNotification(headers, rawBody): Promise<{ resource: unknown }>`：
  - 读取 `wechatpay-timestamp / wechatpay-nonce / wechatpay-signature / wechatpay-serial`；
  - 时间戳偏差 >5 分钟拒绝；
  - 验签报文 `timestamp\nnonce\nrawBody\n`；
  - `resource` 用 APIv3 key `AES-256-GCM` 解密（去掉末 16 字节 auth tag）。
- `private async resolveWechatPublicKey(serial)`：
  - `serial` 以 `PUB_KEY_ID_` 开头：必须与 `config.publicKeyId` 一致且已配置 `publicKeyPem`，否则报「微信支付公钥未配置/ID 不匹配」；
  - 其他：平台证书模式，`GET /v3/certificates` → 解密 `encrypt_certificate` → `new X509Certificate(pem).publicKey`，模块级缓存 12 小时，按 serial 命中。

`apps/api/src/modules/payment/wechat/wechat-payment.provider.ts`

- `createPayment`：未拿到 openid 时抛 `BadRequestException('微信支付需要用户 openid')`；调用 client，返回 `{ provider:'wechat', orderNo, prepayId, payParams }`。
- `verifyCallback`：`verifyNotification` 后映射：
  - `trade_state === 'SUCCESS'` → `SUCCESS`，`amountCents = resource.amount.total`，`transactionId = resource.transaction_id`，`paidAt = success_time`；
  - 其他（`NOTPAY/CLOSED/REFUND/PAYERROR`）→ `FAILED`。
- `readonly name = 'wechat'`。

`apps/api/src/modules/payment/wechat/wechat-refund.provider.ts`

- `refund` 映射：`SUCCESS → SUCCESS`、`PROCESSING → PROCESSING`、`ABNORMAL/CLOSED → FAILED`（带 `failReason`）。
- `transactionId = refund_id`，`raw` 返回原始响应。

`apps/api/src/modules/payment/wechat/wechat-pay.client.test.ts`

- 用 `generateKeyPairSync('rsa', 2048)` 自造密钥，AES-256-GCM 加密伪造回调，验证：签名通过、篡改报文失败、解密字段正确、JSAPI 支付参数签名可被公钥验证。
- 公钥模式：`PUB_KEY_ID_` + 公钥验签通过。

### 3.2 接口与业务改造

`payment.provider.ts`

- `PaymentParams` 增加 `payParams?: { timeStamp; nonceStr; package; signType; paySign }`。
- `RefundResult.status` 扩展为 `'SUCCESS' | 'FAILED' | 'PROCESSING'`，增加可选 `raw?: unknown`。
- `RefundProvider.refund(input)` 输入扩展：`totalCents: number; transactionId?: string; reason?: string`（Mock 实现忽略新增字段）。

`payment.service.ts`

- `provider()`：`wechat` 时 `new WechatPaymentProvider(await this.integration.wechatPayConfig())`；删除 503。
- `pay()`：查询 `user.openid` 并传入 `createPayment`。
- `handleCallback` 保持幂等与金额校验逻辑，`rawCallback` 仍存原始 JSON 报文。

`payment.controller.ts`

- 回调使用 `RawBodyRequest<Request>.rawBody` 转 utf8；缺失时报 400。

`main.ts`

- `NestFactory.create(AppModule, { rawBody: true })`。

`aftersale.service.ts`

- 注入 `IntegrationService`。
- `executeRefund` 查该订单成功的 `Payment`：
  - `payment.provider === 'wechat'` → `new WechatRefundProvider(await this.integration.wechatPayConfig())`，退款输入带 `totalCents = order.payableCents`、`transactionId = payment.transactionId`、`reason = 售后原因`；
  - 否则 `MockRefundProvider`。
- 退款记录 `provider` 用实际渠道名。
- `PROCESSING`：更新 `refund.transactionId/rawResponse`，保持 `PENDING`，返回 `{ refundNo, status: 'PROCESSING' }`，售后单保持 `REFUNDING`，不累计退款金额。

### 3.3 集成配置与数据模型

Prisma `IntegrationConfig` 新增：

- `wechatPayPublicKeyId String?`
- `wechatPayPublicKeyFile String?`
- `wechatPayPublicKeyName String?`

迁移文件：`prisma/migrations/<ts>_wechat_pay_public_key/migration.sql`（仅 3 个可空列，向后兼容）。

`IntegrationService`：

- `SECRET_FIELDS` 增加 `wechatPayPublicKey`，扩展名 `.pem/.txt/.key`，校验内容包含 `BEGIN PUBLIC KEY`。
- `detail()` 返回 `wechatPayPublicKeyId` 与 `wechatPayPublicKey` 元信息。
- `UpdateIntegrationInput` / `update()` 支持 `wechatPayPublicKeyId`（≤64 字符）。
- 新增 `async wechatPayConfig(): Promise<WechatPayConfig>`：
  - 从配置取 appId/mchId/certSerial/notifyUrl；
  - 读取 APIv3 密钥文件（trim）、商户私钥文件、可选公钥文件；
  - 缺失必填项时抛 `ServiceUnavailableException`，消息列出缺失项（如「微信支付未配置完整：商户号、APIv3 密钥」）；
  - 私钥仅支持 PEM（`.p12/.pfx` 明确提示需转换为 PEM）。

`integration.controller.ts`：DTO 增加 `wechatPayPublicKeyId`。

### 3.4 后台页面

`apps/admin/src/pages/Integration.tsx`

- 微信支付卡片：
  - 删除「渠道尚未接入」提示与保存时的确认弹窗；
  - 新增「微信支付公钥 ID」输入（公钥模式填写，平台证书模式留空）；
  - 新增「微信支付公钥」`SecretRow`；
  - 回调地址提示改为 `https://car.aition.art/api/payments/callback`。
- `SecretField`、`SECRET_ACCEPT`、`secretMeta()` 同步 4 个密钥字段。

`apps/admin/src/pages/PaymentSettings.tsx`

- 运行状态文案改为真实接入说明；移除「尚未接入」步骤清单，改为「配置检查」清单。

### 3.5 小程序支付

新增 `apps/miniapp/src/utils/pay.ts`：

```ts
export type PayOutcome = 'paid' | 'pending';
export async function payOrder(orderId: string): Promise<PayOutcome>;
```

行为：

1. `POST /orders/:id/pay` 取 `{provider, outTradeNo, payParams}`。
2. `mock`：调用 `/payments/mock/confirm`，返回 `paid`。
3. `wechat`：
   - 非 `weapp`（H5 预览）直接抛「请在微信小程序内完成支付」；
   - `Taro.requestPayment({timeStamp, nonceStr, package, signType:'RSA', paySign})`；
   - 成功后轮询 `GET /orders/:id` 最多 5 次（间隔 800ms），`PAID` → `paid`，否则 `pending`。
   - 用户取消（errMsg 含 `cancel`）→ 抛出「已取消支付」。
4. 三个页面改为 `const outcome = await payOrder(id)`，跳转 `pay-result` 时 `status=success|pending`。

### 3.6 契约与文档

- `openapi.yaml`：
  - `/orders/{id}/pay` summary 改为「发起支付，返回渠道参数」；
  - `PaymentParams` 增加 `payParams`（timeStamp/nonceStr/package/signType/paySign），`provider` 枚举不变。
- 契约测试保持 mock 模式（DB 默认 `paymentProvider=mock`），现有用例不改断言。

## 4. 验证

本地：

1. `pnpm --filter @shanye/api exec prisma migrate dev --name wechat_pay_public_key`（本地 DB 不可用时手写迁移 SQL）。
2. 新增/执行单元测试：`pnpm vitest run apps/api/src/modules/payment/wechat/wechat-pay.client.test.ts`。
3. `pnpm verify`（lint + typecheck + 覆盖率 + api 构建 + 契约 + web 构建）。

服务器（`aition-prod`）：

1. `pnpm deploy:remote` 部署（含迁移）。
2. 后台「集成配置」上传 APIv3 密钥、商户私钥，保存：
   - 商户号 `1716944776`
   - 证书序列号 `7BC09B93B0DACE88AC3C112E939E1596E2F2F216`
   - 回调地址 `https://car.aition.art/api/payments/callback`
3. 使用商户签名调用 `GET /v3/pay/transactions/out-trade-no/{临时单号}?mchid=1716944776`：
   - 返回 `ORDER_NOT_EXIST` ⇒ 签名/证书/序列号正确；
   - 返回 `401 SIGN_ERROR` ⇒ 私钥/序列号不匹配，停止后续步骤。
4. 切换 `provider=wechat`，真机小程序下单调起支付并完成一笔真实支付，确认回调后订单变「已支付」、库存扣减、积分发放。
5. 用 `GET /v3/pay/transactions/id/{transaction_id}?mchid=...` 复核金额与状态。
6. 不发起真实退款；退款链路由单元测试 + 商户平台确认覆盖。

## 5. 风险与回滚

- 回调必须公网 HTTPS 且域名与后台配置一致；配置错误时微信持续重试，订单保持待支付。
- 若商户为公钥模式，必须上传公钥与公钥 ID，否则回调验签失败（错误信息会明确提示）。
- 回滚：后台把 `paymentProvider` 切回 `mock` 即恢复原闭环；新列可空，无需回滚数据库。
