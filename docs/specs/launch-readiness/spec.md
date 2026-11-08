# 二期迭代 A：上线收尾（订阅消息 / 退款对账 / 监控与备份）

状态：已实现（本地验收通过，未部署云服务器）
范围：服务端通知与对账任务、系统状态与告警、备份脚本、后台最小页面、小程序订阅授权、契约与文档
环境：本地开发与本地验收，**不部署云服务器**（不执行 `pnpm deploy:remote`）

## 1. 目标

1. 订阅消息可发送：支付成功、订单发货、售后退款结果三类通知，带发送日志、失败重试与去重。
2. 退款结果不再依赖人工确认：定时查询微信退款单，`PROCESSING` 自动对账，异常进入后台待处理列表。
3. 本地可观测：系统状态接口（磁盘、备份新鲜度、待处理退款、通知失败数）与定时日志告警；上传目录纳入备份。
4. 小程序在支付、售后提交节点引导订阅授权。

## 2. 非目标

- 不做真实支付扣款验收（本地无真机与公网回调；上线前需真机执行第 6 节清单）。
- 不实现 SubscriptionGrant 授权次数表：微信一次性订阅由微信侧消费，服务端只记录发送日志。
- 不接第三方物流轨迹查询、不做首页运营位（迭代 B）。
- 不迁 OSS/CDN、不新增 Nginx/云监控等外部依赖；告警以服务端结构化日志输出。
- 不引入 `@nestjs/schedule`、axios、微信 SDK 等新依赖；沿用 `setInterval(...).unref()` 与 `fetch`。

## 3. 现状要点

- 集成配置已有 `subscribeTemplateIds { orderPaid, orderShipped, refundResult }`，无发送实现。
- [wechat-pay.client.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/payment/wechat/wechat-pay.client.ts) 已具备 APIv3 签名/验签、`refund`，缺 `queryRefund`。
- [aftersale.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/aftersale/aftersale.service.ts) 的 `executeRefund` 在 `PROCESSING` 时保留 `PENDING`，成功逻辑内联在方法中，需要抽出以便对账复用。
- [admin-order.controller.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/admin/admin-order.controller.ts#L105-L146) 发货成功后无通知。
- [backup-db.sh](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/scripts/backup-db.sh) 只备份数据库，不包含 `UPLOAD_DIR/assets`。
- 定时任务范式见 [order-timeout.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/order/order-timeout.service.ts)。

## 4. 设计

### 4.1 数据模型（apps/api/prisma/schema.prisma）

`Refund` 增加：

```prisma
  /// 渠道侧退款状态：PROCESSING / SUCCESS / ABNORMAL / CLOSED
  channelStatus String?
  lastQueriedAt DateTime? @db.Timestamptz(3)
```

新增发送日志（不建 User 外键，避免通知与用户模块耦合）：

```prisma
model NotificationLog {
  id           String    @id @default(cuid())
  /// 去重键：scene:业务单号，如同一订单只发一次支付通知
  dedupeKey    String    @unique
  scene        String
  templateId   String
  userId       String
  openid       String?
  page         String?
  dataJson     Json
  /// PENDING | SENT | SKIPPED | FAILED
  status       String    @default("PENDING")
  attempts     Int       @default(0)
  nextRetryAt  DateTime? @db.Timestamptz(3)
  error        String?
  responseJson Json?
  sentAt       DateTime? @db.Timestamptz(3)
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @db.Timestamptz(3)

  @@index([status, nextRetryAt])
  @@index([scene, createdAt])
}
```

`IntegrationConfig` 增加 `subscribeTemplateFields Json?`（模板字段映射，见 4.3）。

迁移：`apps/api/prisma/migrations/20261107050000_launch_readiness/migration.sql`，只新增可空列/新表，可回滚。

### 4.2 微信订阅消息客户端

新增 `apps/api/src/modules/notification/wechat-subscribe.client.ts`：

```ts
export class WechatSubscribeClient {
  constructor(private readonly creds: { appId: string; appSecret: string });
  async send(input: {
    openid: string;
    templateId: string;
    page?: string;
    data: Record<string, { value: string }>;
    miniprogramState?: 'formal' | 'trial' | 'developer';
  }): Promise<{ ok: boolean; errcode?: number; errmsg?: string; raw: unknown }>;
}
```

- access_token：`POST https://api.weixin.qq.com/cgi-bin/stable_token`（`grant_type=client_credential`、`appid`、`secret`、`force_refresh:false`），模块级 Map 按 appId 缓存，提前 5 分钟过期。
- 发送：`POST https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=...`，body `{ touser, template_id, page, data, miniprogram_state }`。
- `errcode` 为 `40001/42001` 时清缓存并重试一次；其余非 0 返回 `{ ok:false, errcode, errmsg, raw }`；网络异常抛出，由调用方记录并重试。
- 凭据来自 `IntegrationService.miniappCredentials()`；AppID/AppSecret 缺失时由服务层记为失败原因。

### 4.3 通知服务与 Outbox

新增 `apps/api/src/modules/notification/notification.service.ts`：

- 场景常量：`ORDER_PAID | ORDER_SHIPPED | REFUND_RESULT`。
- 去重键：`ORDER_PAID:<orderNo>`、`ORDER_SHIPPED:<orderNo>`、`REFUND_RESULT:<refundNo>`；创建时 `createMany({ skipDuplicates: true })` 或捕获 P2002，重复触发不报错。
- 入队方法（只写库，不调用外部接口）：
  - `enqueueOrderPaid(orderId)`：订单号、实付金额、首个商品名、支付时间；落地页 `/pages/order-detail/index?id=<id>`。
  - `enqueueOrderShipped(orderId)`：订单号、物流公司、运单号、发货时间。
  - `enqueueRefundResult(refundId)`：退款单号、商品名、退款金额、退款状态（成功/失败）、完成时间。
- 以下情况写 `SKIPPED` 并记录原因：模板 ID 未配置、用户 openid 缺失。
- `flushPending()`（定时器每 30s，取 `status=PENDING AND nextRetryAt<=now` 最多 20 条）：
  - 发送成功 → `SENT`、`sentAt`；
  - 失败且 `attempts < 5` → 保持 `PENDING`，`attempts+1`，`nextRetryAt = now + [1,2,5,15,60][attempts] 分钟`；
  - 超过 5 次 → `FAILED`，写 `error`。
  - 定时器 `unref()`，`OnModuleDestroy` 清理。
- `retry(id)`：`FAILED/SKIPPED` 重置为 `PENDING`、`attempts=0`、`nextRetryAt=now`。
- `listLogs({ status?, scene?, page, pageSize })`：按 `createdAt desc`，返回总数与条目。
- `sendTest(userId?)`：取指定用户或首个用户，用 `ORDER_PAID` 模板与样例数据立即发送；模板未配置抛 `BadRequestException`。

字段映射（`IntegrationConfig.subscribeTemplateFields`）：

```json
{
  "orderPaid":   { "character_string1": "orderNo", "amount2": "payable", "thing3": "items", "time4": "paidAt" },
  "orderShipped":{ "character_string1": "orderNo", "character_string2": "trackingNo", "thing3": "expressName", "time4": "shippedAt" },
  "refundResult":{ "character_string1": "refundNo", "thing2": "items", "amount3": "amount", "phrase4": "status", "time5": "refundedAt" }
}
```

- 键为微信模板字段名，值为变量名；未配置时使用上述默认映射。
- 可用变量：`orderNo / payable / items / paidAt / trackingNo / expressName / shippedAt / refundNo / amount / status / refundedAt`。
- 格式化：金额 `¥12.34`；时间 `YYYY-MM-DD HH:mm`；`thing` 截断 20 字符；`character_string` 截断 32 字符；未知变量为空串并跳过该字段。
- `IntegrationService.detail()` 返回该映射；`update()` 接收并做 `additionalProperties` 校验（场景键固定，值均为 ≤64 字符字符串）。

接口：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/subscriptions/templates` | 公开 | 返回已配置的模板 ID：`{ templates: { orderPaid?, orderShipped?, refundResult? } }` |
| GET | `/api/admin/notifications/logs` | SUPER/OPS | `status/scene/page/pageSize`，返回 `{ total, page, pageSize, items }` |
| POST | `/api/admin/notifications/:id/retry` | SUPER/OPS | 重置并返回 `{ id, status }` |
| POST | `/api/admin/notifications/test` | SUPER/OPS | body `{ userId? }`，返回 `{ id, ok, error? }` |

模块：新增 `notification.module.ts`（imports `IntegrationModule`，exports `NotificationService`），由 `TradeModule` 引入；`PaymentService`、`AdminOrderController`、`AfterSaleService` 注入 `NotificationService`。

### 4.4 触发点

- 支付成功：[payment.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/payment/payment.service.ts) `handleCallback` 在 `markPaid` 成功后 `await enqueueOrderPaid(payment.orderId)`，`try/catch` 包裹，通知失败不影响支付结果。
- 发货：[admin-order.controller.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/admin/admin-order.controller.ts) `ship` 事务提交后 `enqueueOrderShipped(id)`。
- 退款结果：`executeRefund` 成功后、对账成功后调用 `enqueueRefundResult(refund.id)`；渠道失败/关闭时同样通知（状态为失败）。

### 4.5 退款对账

- `wechat-pay.client.ts` 新增：

```ts
async queryRefund(refundNo: string): Promise<{ refundId: string; status: string; raw: unknown }>;
// GET /v3/refund/domestic/refunds/{out_refund_no}
```

- `aftersale.service.ts` 抽出 `completeRefund(refundId, channel?)`：
  - 入参可选 `{ transactionId?, raw?, channelStatus? }`；
  - 幂等：`updateMany({ where: { id, status: 'PENDING' } })`，影响 0 行直接返回；
  - 内容与现成功事务完全一致：售后单 `COMPLETED`、条目/订单已退金额累加、未发货回滚库存、订单状态（整单退/部分退）、积分与等级扣回、整单退释放优惠券；
  - `executeRefund` 的成功分支改为调用它，避免两份逻辑。
- 新增 `apps/api/src/modules/aftersale/refund-reconcile.service.ts`（`TradeModule` provider）：
  - `queryPending()`：`Refund` 中 `provider='wechat' AND status='PENDING' AND createdAt < now-2min`，每次 20 条；每 5 分钟执行，`unref()`。
  - `queryOne(refundId)`：后台手动查询；非微信渠道抛 `BadRequestException`。
  - 映射：
    - `SUCCESS` → 写 `channelStatus/lastQueriedAt` 后 `completeRefund`，成功后发通知；
    - `PROCESSING` → 只更新 `channelStatus='PROCESSING'`、`lastQueriedAt`；
    - `ABNORMAL` → `channelStatus='ABNORMAL'`、`lastQueriedAt`，保持 `PENDING` 供后台处理；
    - `CLOSED` → `status='FAILED'`、`failReason='渠道已关闭退款'`、`channelStatus='CLOSED'`，发失败通知。
  - 配置缺失/网络错误：记录 `Logger.warn`，不修改退款单。
- `executeRefund` 的 `PROCESSING` 分支写入 `channelStatus='PROCESSING'`。
- 后台接口：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/refunds` | SUPER/OPS/CS | `status/channelStatus/page/pageSize`，返回退款单 + 售后单号 + 订单号 |
| POST | `/api/admin/refunds/:id/query` | SUPER/OPS/CS | 立即查询，返回 `{ id, status, channelStatus }` |

### 4.6 系统状态与告警

新增 `apps/api/src/modules/ops/{ops.module.ts,ops.service.ts,ops.controller.ts}`：

- `GET /api/admin/ops/status`（SUPER/OPS）返回：

```ts
{
  now: string; uptimeSeconds: number;
  disk: { path: string; totalBytes: number; freeBytes: number; usedRatio: number };
  backup: { dir: string; latestFile: string | null; latestAt: string | null; ageHours: number | null; stale: boolean };
  notifications: { pending: number; failed: number };
  refunds: { pending: number; abnormal: number; oldestPendingHours: number | null };
  payment: { provider: 'mock' | 'wechat'; subscribeConfigured: boolean };
  alerts: { level: 'warn' | 'error'; code: string; message: string }[];
}
```

- 磁盘：`statfs(uploadRoot())`（`node:fs/promises`），`usedRatio = 1 - free/total`；≥0.85 warn，≥0.95 error。
- 备份目录解析顺序：`BACKUP_DIR` → `process.cwd()/backups` → `process.cwd()/../../backups` → 默认 `process.cwd()/backups`；取最新 `shanye-*.sql.gz`；无备份或 `ageHours > 48` 为 `stale`（error）。
- 告警项：磁盘、备份过期、`refunds.abnormal > 0`（error）、`notifications.failed > 0`（warn）、`refunds.pending > 0 且 oldestPendingHours > 24`（warn）。
- 定时检查每 10 分钟，逐条 `Logger.warn/error`，`unref()`。
- `OpsModule` 在 `AppModule` 注册，沿用 `JwtAuthGuard/RolesGuard`。

### 4.7 备份脚本

`scripts/backup-db.sh`：

- 读取 `UPLOAD_DIR`（环境变量或 `apps/api/.env`），默认 `apps/api/uploads`。
- 数据库备份后，若 `<UPLOAD_DIR>/assets` 存在：`tar -czf backups/shanye-uploads-$STAMP.tar.gz -C "$UPLOAD_DIR" assets`，文件权限 `600`；目录不存在则打印提示并继续。
- 保留策略同时清理 `shanye-uploads-*.tar.gz`：`find ... -mtime +RETENTION_DAYS -delete`。
- 任一备份失败返回非 0。

### 4.8 后台页面

新增 `apps/admin/src/pages/SystemStatus.tsx`（路由 `/settings/system`，菜单「设置 → 系统状态」，SUPER/OPS）：

- 顶部告警区：磁盘使用率、备份时间、待处理退款、通知失败数；有 error 时红色提示。
- 通知日志表：场景、状态、尝试次数、错误、时间；操作「重试」「发送测试」。
- 退款对账表：退款单号、订单号、金额、状态、渠道状态、最近查询；操作「立即查询」。
- 加载时拉取，提供「刷新」按钮。

`apps/admin/src/pages/Integration.tsx`：

- 订阅消息卡片增加「模板字段映射（JSON）」文本域，回填 `subscribeTemplateFields`；保存前 `JSON.parse` 校验，非法时 toast 阻止提交；提示默认映射规则。

### 4.9 小程序订阅授权

- 新增 `apps/miniapp/src/utils/subscribe.ts`：

```ts
export type SubscribeScene = 'orderPaid' | 'orderShipped' | 'refundResult';
export async function requestSubscriptions(scenes: SubscribeScene[]): Promise<void>;
```

  - 非 `weapp` 直接返回；`GET /subscriptions/templates` 取模板 ID；无可用模板返回；`Taro.requestSubscribeMessage({ tmplIds })`，用户拒绝/报错静默（不阻断主流程）。
- `utils/pay.ts`：拿到支付参数后、`Taro.requestPayment` 前 `await requestSubscriptions(['orderPaid', 'orderShipped'])`（保持在点击手势链内）。
- 售后提交页 `pages/after-sale/apply/index.tsx`：提交前 `await requestSubscriptions(['refundResult'])`。

### 4.10 契约与文档

- `openapi.yaml` 新增/更新：`/subscriptions/templates`、`/admin/notifications/logs`、`/admin/notifications/{id}/retry`、`/admin/notifications/test`、`/admin/refunds`、`/admin/refunds/{id}/query`、`/admin/ops/status`；`/admin/integration` 的 PATCH 与 `IntegrationConfig` 增加 `subscribeTemplateFields`；`AfterSale.refund` 增加 `channelStatus`。
- `pnpm codegen:api` 更新 `packages/api-types/src/schema.d.ts`。
- 契约测试新增 `apps/api/test/contract/ops.contract.test.ts`：登录后台后校验通知日志、系统状态、退款列表结构、公开模板接口、手动查询不存在退款返回 404。
- 单元测试新增 `apps/api/test/unit/wechat-subscribe.client.test.ts`：桩 `fetch` 验证 token 缓存、40001 重试一次、errcode 透传。

## 5. 本地验证

1. `pnpm --filter @shanye/api exec prisma migrate dev`（本地 5433），确认新表与新列。
2. `pnpm prepare:types`（Prisma Client + codegen）。
3. `pnpm vitest run apps/api/test/unit/wechat-subscribe.client.test.ts`（新增用例）。
4. `pnpm verify` 全绿（lint、typecheck、覆盖率、api 构建、契约、web 构建）。
5. 本地启动 API，后台打开「系统状态」：磁盘/备份/待处理数据可读；未配置模板时「发送测试」返回可读错误；手动查询 mock 退款返回 400。
6. `UPLOAD_DIR=<repo>/apps/api/uploads bash scripts/backup-db.sh`：生成 `.sql.gz` 与 `.tar.gz` 各一份。
7. H5 预览确认订阅授权在非微信环境静默跳过、支付与售后流程不回归。

## 6. 真机验收清单（本轮不执行，留待部署后）

1. 真机完成一笔微信支付，订单变「已支付」，支付成功通知到达。
2. 后台发货，用户收到发货通知，点击进入订单详情。
3. 发起售后并审核通过，退款成功后收到退款结果通知。
4. 弱网与支付取消场景不产生重复通知；重复回调不重复扣库存。
5. 微信公众平台「订阅消息 → 发送记录」与后台通知日志一致。

## 7. 风险

- 一次性订阅需用户逐次授权，无法保证 100% 触达；发送失败会重试但授权缺失时记为 `SKIPPED`。
- 模板字段名因模板而异，必须由后台映射与实际模板一致，否则微信返回 `47003`，日志可见。
- 本地无微信凭据时只能验证入队/重试/日志链路，真实发送待部署后真机验证。
- 对账任务与后台手动查询可能并发，`completeRefund` 以条件更新保证仅一次生效。
- 上传目录备份随图片增长，需关注磁盘阈值告警与保留天数。

## 8. 回滚

- 迁移仅新增可空列/新表，回滚可直接停用定时任务；后台切回 mock 支付不影响通知日志表。
- 出现异常时可临时停用订阅发送：清空集成配置模板 ID，入队记录为 `SKIPPED`。
