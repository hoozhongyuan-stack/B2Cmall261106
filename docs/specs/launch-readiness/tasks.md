# 迭代 A 任务清单

状态：已完成（本地验收通过）
依据：[spec.md](./spec.md)
执行方式：按顺序完成，每完成一组跑一次针对性检查；最后统一 `pnpm verify`。

## T1 数据模型与迁移

- [x] `apps/api/prisma/schema.prisma`
  - `Refund` 增加 `channelStatus String?`、`lastQueriedAt DateTime? @db.Timestamptz(3)`
  - 新增 `NotificationLog`（字段与索引见 spec 4.1）
  - `IntegrationConfig` 增加 `subscribeTemplateFields Json?`
- [x] 新建 `apps/api/prisma/migrations/20261107050000_launch_readiness/migration.sql`（只增不毁）
- [x] `pnpm --filter @shanye/api exec prisma migrate dev`，确认本地库结构

## T2 微信订阅客户端

- [x] 新增 `apps/api/src/modules/notification/wechat-subscribe.client.ts`
  - stable_token 缓存（提前 5 分钟过期，按 appId）
  - `send()` 调用订阅消息发送接口，40001/42001 清缓存重试一次
  - 非 0 errcode 返回 `{ ok:false, errcode, errmsg, raw }`，网络异常抛出
- [x] 新增 `apps/api/test/unit/wechat-subscribe.client.test.ts`（桩 fetch）

## T3 通知服务与模块

- [x] 新增 `apps/api/src/modules/notification/notification.service.ts`
  - 场景/去重键、模板与字段映射（含默认映射）、变量格式化
  - `enqueueOrderPaid / enqueueOrderShipped / enqueueRefundResult`
  - 缺模板/缺 openid 记 `SKIPPED`
  - `flushPending()` 每 30s，重试 5 次退避 `[1,2,5,15,60]` 分钟
  - `listLogs / retry / sendTest`
- [x] 新增 `apps/api/src/modules/notification/notification.controller.ts`（后台 3 个接口）
- [x] 新增 `apps/api/src/modules/notification/subscribe.controller.ts`（公开模板接口）
- [x] 新增 `apps/api/src/modules/notification/notification.module.ts` 并导出 `NotificationService`
- [x] `TradeModule` 引入 `NotificationModule`

## T4 触发点接入

- [x] `payment.service.ts`：`markPaid` 成功后入队支付成功通知（try/catch）
- [x] `admin-order.controller.ts`：`ship` 事务后入队发货通知
- [x] `aftersale.service.ts`：退款成功/失败后入队退款结果通知

## T5 退款查询与对账

- [x] `wechat-pay.client.ts` 增加 `queryRefund()`
- [x] `aftersale.service.ts` 抽出 `completeRefund(refundId, channel?)`，`executeRefund` 成功分支改调用；`PROCESSING` 写 `channelStatus`
- [x] 新增 `apps/api/src/modules/aftersale/refund-reconcile.service.ts`
  - 每 5 分钟扫描微信 `PENDING` 退款（创建 >2 分钟）
  - 状态映射与异常处理（SUCCESS/PROCESSING/ABNORMAL/CLOSED）
  - `queryOne()` 供后台手动查询
- [x] 新增后台退款接口（`GET /admin/refunds`、`POST /admin/refunds/:id/query`）
- [x] `TradeModule` 注册对账服务

## T6 系统状态与告警

- [x] 新增 `apps/api/src/modules/ops/ops.service.ts`（磁盘、备份、通知、退款、告警）
- [x] 新增 `apps/api/src/modules/ops/ops.controller.ts`（`GET /admin/ops/status`）
- [x] 新增 `apps/api/src/modules/ops/ops.module.ts`，在 `AppModule` 注册
- [x] 每 10 分钟定时检查并输出结构化告警日志

## T7 备份脚本

- [x] `scripts/backup-db.sh`：读取 `UPLOAD_DIR`，打包 `assets` 为 `shanye-uploads-*.tar.gz`
- [x] 权限 600、保留策略覆盖上传备份、失败返回非 0

## T8 后台页面

- [x] 新增 `apps/admin/src/pages/SystemStatus.tsx`（告警、通知日志、退款对账）
- [x] `App.tsx` 增加路由 `/settings/system`
- [x] `Layout.tsx` 增加「设置 → 系统状态」（SUPER/OPS）
- [x] `Integration.tsx` 增加模板字段映射 JSON 编辑与校验

## T9 小程序

- [x] 新增 `apps/miniapp/src/utils/subscribe.ts`
- [x] `utils/pay.ts` 支付前请求 `orderPaid + orderShipped` 订阅
- [x] `pages/after-sale/apply/index.tsx` 提交前请求 `refundResult` 订阅

## T10 契约、文档与验证

- [x] `openapi.yaml` 补齐 7 个新路径、集成配置字段、售后退款渠道字段
- [x] `pnpm codegen:api`
- [x] 新增 `apps/api/test/contract/ops.contract.test.ts`
- [x] `pnpm verify` 全绿
- [x] 本地启动验收（系统状态页、备份脚本、H5 回归）
- [x] 输出「真机验收清单」执行说明（不部署）

## 完成标准

- 通知失败可重试、可在后台查看；重复业务事件不重复入队。
- `PROCESSING` 退款自动对账；异常退款在后台可见并可手动查询。
- 系统状态接口返回磁盘/备份/告警；备份脚本同时产出数据库与上传目录备份。
- `pnpm verify` 全绿，本地页面可操作。
