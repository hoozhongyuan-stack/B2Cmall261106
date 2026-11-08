# 微信支付接入任务清单

## T1 数据模型与集成配置

- [x] `apps/api/prisma/schema.prisma`：`IntegrationConfig` 增加 `wechatPayPublicKeyId`、`wechatPayPublicKeyFile`、`wechatPayPublicKeyName`
- [x] 生成迁移 `wechat_pay_public_key`（3 个可空列）
- [x] `integration.service.ts`：
  - `SECRET_FIELDS` 增加 `wechatPayPublicKey`
  - `SECRET_SPEC` 增加公钥规格 + 内容校验（`BEGIN PUBLIC KEY`）
  - `detail()` 返回新字段；`update()` 支持 `wechatPayPublicKeyId`
  - `oldFile/fileColumns/clearColumns` 覆盖新字段
  - 新增 `wechatPayConfig()`（读密钥文件、缺失项报 503）
- [x] `integration.controller.ts`：DTO 增加 `wechatPayPublicKeyId`
- [x] `apps/admin/src/pages/Integration.tsx`：公钥 ID 输入、公钥上传、移除「待接入」提示

## T2 微信支付客户端

- [x] `payment/wechat/wechat-pay.config.ts`：`WechatPayConfig`
- [x] `payment/wechat/wechat-pay.client.ts`：
  - 请求签名（SHA256-RSA2048）
  - `createJsapiPayment` + 小程序支付参数签名
  - `verifyNotification`（验签 + AES-GCM 解密 + 时间戳校验）
  - `resolveWechatPublicKey`（公钥模式 / 平台证书缓存 12h）
  - `refund`
- [x] `payment/wechat/wechat-payment.provider.ts`
- [x] `payment/wechat/wechat-refund.provider.ts`

## T3 业务接线

- [x] `main.ts`：`rawBody: true`
- [x] `payment.controller.ts`：回调用 `req.rawBody`
- [x] `payment.provider.ts`：`PaymentParams.payParams`、`RefundResult.PROCESSING`、退款输入扩展
- [x] `payment.service.ts`：provider 选择真实实现；`pay()` 传 openid
- [x] `aftersale.service.ts`：按成功支付单选择退款渠道；处理 `PROCESSING`

## T4 小程序支付

- [x] 新增 `apps/miniapp/src/utils/pay.ts`（mock / wechat 分支、H5 拦截、requestPayment、轮询）
- [x] `pages/checkout/index.tsx`、`pages/order-detail/index.tsx`、`pages/orders/index.tsx` 改用 `payOrder`
- [x] `pages/pay-result/index.tsx` 确认 `status=pending` 文案可用（复用现有分支）

## T5 文档与测试

- [x] `openapi.yaml`：`PaymentParams.payParams`、支付接口 summary
- [x] `wechat-pay.client.test.ts`：验签/解密/支付参数签名/公钥模式
- [x] `pnpm verify` 全绿

## T6 部署联调

- [x] `pnpm deploy:remote` 部署并执行迁移
- [x] 后台上传 APIv3 密钥与商户私钥，保存商户号/序列号/回调地址
- [x] 服务器验证：查询不存在订单返回 `ORDER_NOT_EXIST`（签名正确）
- [x] 服务器验证：JSAPI 下单仅报「无效的openid」（appid/mchid/签名链路正确）
- [x] 服务器验证：伪造回调返回 400「微信支付报文验签失败」（平台证书下载 + APIv3 解密链路正常）
- [ ] 真机真实支付一笔并核对订单状态（需用户在微信小程序内完成）
- [ ] 复核交易详情，确认金额一致；不发起真实退款（需真实支付后执行）
