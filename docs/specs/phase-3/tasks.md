# 三期任务清单（迭代 A–D）

状态：A 待开始；B/C/D 待前序完成
依据：[spec.md](./spec.md) · [三期规划](../../planning/phase-3.md)
执行方式：按 A → B → C → D 顺序推进；每个迭代完成后跑针对性检查，最后统一 `pnpm verify` + `pnpm test:e2e`。

## T0 前置质量门禁（已完成）

- [x] 执行 `pnpm verify`：lint / typecheck / 66 条单测 / 64 条契约 / API 构建 / 后台与 H5 构建全部通过
- [x] 执行 `pnpm test:e2e`：5 条主链路通过
- [x] 确认 codegen 同步：`packages/api-types/src/schema.d.ts` 哈希在 `pnpm prepare:types` 前后一致
- [x] 确认迁移可在空库执行：15 个迁移全部应用成功
- [x] 修复 E2E 数据依赖
  - [x] `admin-miniapp-release.spec.ts` 兼容「有发布记录 / 无发布记录」
  - [x] `h5-order.spec.ts` 选择未参与秒杀且有库存的商品
- [x] 原生 SQL 收敛到 `apps/api/src/prisma/queries.ts`，并在 ESLint 增加 `$queryRaw/$executeRaw` 位置规则
- [x] 记录历史迁移与状态规则偏差（见 spec 3.3）
- [x] 复跑 `pnpm verify` 与 E2E，全绿

## 迭代 A：门店与库存底座

### A1 数据模型与迁移

- [x] `apps/api/prisma/schema.prisma`
  - 新增 `Store`、`AdminStore`、`StoreSku`、`StoreStockLog`、`StoreDeliveryRegion`
  - `Order` 增加 `fulfillmentType String @default("EXPRESS")`、`storeId String?`、`pickupCode String? @unique`、`pickupAt`、`pickupCodeExpiresAt`
  - `AdminRole` 增加 `STORE`
- [x] 新建迁移 `apps/api/prisma/migrations/20261107215317_stores/migration.sql`（只增不毁）
  - 同时修正历史迁移的 `TIMESTAMP(3)` 漂移：`IntegrationConfig.updatedAt`、`MiniappRelease.createdAt/updatedAt` 统一为 `TIMESTAMPTZ(3)`
- [x] 应用迁移并 `prisma migrate resolve --applied 20261107215317_stores`
- [x] `pnpm --filter @shanye/api exec prisma generate`
- [x] 空测试库 `prisma migrate reset` 验证 16 个迁移全部成功

### A2 门店模块与权限

- [x] 新增 `apps/api/src/modules/store/store.module.ts`
- [x] 新增 `store.service.ts`：公开门店列表/详情、后台 CRUD、启停、排序
- [x] 新增 `store-scope.service.ts`：总部全量，`STORE` 按 `AdminStore` 过滤
- [x] 新增 `store.controller.ts`、`store-admin.controller.ts`
- [x] 前端通过 `GET /admin/stores/mine` 获取可访问门店（登录响应不携带门店列表）
- [x] `AdminAuthController.me` 的 `@Roles` 加入 `STORE`
- [x] `AppModule` 注册 `StoreModule`
- [x] `AdminAccountService` 支持门店账号与多门店绑定（`AdminStore`）
- [x] `openapi.yaml` 补门店与账号门店字段，执行 `pnpm codegen:api`
- [x] 新增 `apps/api/test/contract/store.contract.test.ts`（4 条）

### A3 门店库存

- [x] `StoreStockService` 实现门店库存查询、调整、批量设置、库存流水
- [x] 门店库存调整写 `StoreStockLog` 与操作日志
- [x] `order.service.ts` 按 `fulfillmentType` 选择库存来源
  - [x] `EXPRESS`：保持 `Sku.stock/reserved`
  - [x] `PICKUP/DELIVERY`：`StoreSku` 条件更新，防超卖
- [x] `cancel`、`order-timeout.service.ts`、退款回滚按来源仓释放
- [x] 门店库存不足返回明确错误，提示切换门店或快递
- [x] 并发与回滚验证：50 并发抢 10 件成功恰为 10；取消释放、支付扣减、退款回补（`store.contract.test.ts`）
- [x] `openapi.yaml` 补门店库存与订单履约字段，执行 `pnpm codegen:api`

### A4 订单归属与筛选

- [x] `Order` 写入 `storeId`、`fulfillmentType`（A3 已完成）
- [x] `GET /admin/orders` 支持 `storeId`、`fulfillmentType` 筛选
- [x] 订单详情返回门店名称、履约方式（A3 已完成）
- [x] 门店账号默认锁定授权门店，越权订单列表筛选与详情均返回 404
- [x] 契约测试：订单门店筛选、履约方式筛选、门店账号订单范围
- [x] `openapi.yaml` 补后台订单筛选参数与 `AdminOrderListItem`，执行 `pnpm codegen:api`

### A5 后台门店页面

- [x] 新增 `apps/admin/src/pages/Stores.tsx`
  - 列表、编辑、启停、排序
  - 营业时间（按周编辑）、自提开关、配送开关
  - 配送区县、配送费、免配送门槛、配送时段、截单时间、每时段最大单量
  - 自提完成天数 `pickupCompleteDays`
- [x] 新增门店库存弹窗：SKU 搜索、调整、批量保存、安全库存、添加商品、库存流水
- [x] 新增 `GET /admin/stores/:storeId/sku-options` 支持添加未配置 SKU
- [x] `App.tsx` 增加路由 `/settings/stores`
- [x] `Layout.tsx` 增加「门店 → 门店管理」与顶部门店切换器
- [x] `Orders.tsx` 增加门店与履约方式筛选，列表展示门店 / 履约
- [x] `Accounts.tsx` 支持 `STORE` 角色、创建与修改多门店绑定
- [x] `openapi.yaml` 补 `sku-options` 与 `StoreSkuOption`，执行 `pnpm codegen:api`

### A6 门店看板 v1

- [x] `GET /admin/stores/:id/dashboard`
  - 今日支付订单、营业额、退款、待自提、待配送、库存预警
- [x] 后台门店看板弹窗（门店列表「看板」入口）
- [x] 门店账号只返回授权门店数据，跨店看板 404
- [x] 契约测试：看板指标结构、门店账号范围、跨店 404
- [x] `openapi.yaml` 补看板路径与 `StoreDashboard`，执行 `pnpm codegen:api`

### A7 测试与验收

- [x] 新增 `apps/api/test/contract/store.contract.test.ts`（7 条）
- [x] 并发与回滚覆盖：50 并发、取消释放、支付扣减、退款回补
- [x] 新增 `e2e/admin-stores.spec.ts`：门店列表/库存/看板、门店账号只看本店
- [x] 本地验收：门店 CRUD、库存扣减/回滚、订单筛选、看板
- [x] `pnpm verify` + `pnpm test:e2e`（7 条）全绿

迭代 A 已完成：门店可配置、库存独立不超卖、门店账号数据隔离、快递链路无回归。

完成标准：门店可配置；门店库存独立且不超卖；门店账号数据隔离；快递链路无回归。

---

## 迭代 B：到店自提与核销

### B1 数据模型与迁移

- [x] 新增 `PickupVerification`（orderId 唯一、method、verifiedBy、verifiedAt、note）
- [x] 迁移 `20xxxxxx_pickups`（只增不毁）
- [x] `Order.pickupCode` 唯一索引与 `pickupCodeExpiresAt`

### B2 自提下单与金额

- [x] `orders/preview` 入参支持 `fulfillmentType=PICKUP`、`storeId`、`pickupSlot`
- [x] 校验门店 `pickupEnabled`、营业时间、时段、门店库存
- [x] 自提运费 0；`addressSnapshot` 存门店快照与手机号
- [x] 下单写入 `fulfillmentType`、`storeId`、`pickupAt`
- [x] 单测：自提运费 0、门店库存不足、与秒杀组合（契约测试覆盖）

### B3 核销码

- [x] 支付成功后生成 8 位随机核销码（唯一、防猜测）
- [x] `pickupCodeExpiresAt` 按门店 `pickupCompleteDays` 计算
- [x] 取消、退款、超时关单后核销码失效
- [x] 入队 `PICKUP_READY` 通知

### B4 核销台

- [x] `POST /admin/pickups/verify`（入参 code）
- [x] 校验顺序：门店授权 → 订单 `PAID` → `PICKUP` → 未退款 → 码有效 → 未核销
- [x] 重复核销返回已核销信息；跨门店 404
- [x] 核销成功：`pickup_verify` 状态动作、写 `PickupVerification`、操作日志、积分发放
- [x] `GET /admin/pickups` 待核销与核销记录，支持门店筛选
- [x] 核销接口限流

### B5 超时自动完成

- [x] 新增 `PickupTimeoutService`，每 10 分钟扫描到期自提订单
- [x] 到期前 1 天入队 `PICKUP_EXPIRING`（每天最多一次）
- [x] 到期执行 `pickup_verify`，`method=AUTO`，订单完成
- [x] 不回滚库存、不退款；`PickupVerification` 记录 `AUTO`，后台可筛选

### B6 状态机

- [x] `packages/shared/src/orderState.ts` 增加 `pickup_verify`（`PAID → COMPLETED`）
- [x] `buyerActions` 按履约方式派生
- [x] 单测覆盖新增动作与非法迁移

### B7 后台页面

- [x] 新增 `apps/admin/src/pages/Pickups.tsx`
  - 待核销列表、扫码/输码、核销记录
  - 门店筛选、核销人、时间、方式
- [x] `App.tsx` 路由 `/fulfillment/pickups`
- [x] `Layout.tsx` 菜单「履约 → 自提核销」
- [x] 订单详情展示核销信息与门店

### B8 小程序

- [x] 结算页增加履约方式选择：快递 / 自提 / 配送（配送入口 C 阶段开放）
- [x] 新增门店选择页 `apps/miniapp/src/pages/store/list/`
- [x] 自提时段选择与校验
- [x] 订单详情展示核销码、二维码、门店地址、营业时间、剩余时间
- [x] 订阅 `PICKUP_READY` 模板

### B9 测试与验收

- [x] 新增 `apps/api/test/contract/pickup.contract.test.ts`
- [x] E2E：H5 自提下单 → 支付 → 后台核销 → 订单完成
- [x] 验收：支付后立即出码；重复/跨店/已退款核销 0 发生；超时自动完成记录 `AUTO`
- [x] `pnpm verify` + `pnpm test:e2e` 全绿

完成标准：自提从下单到核销闭环可用；核销幂等与权限正确；超时策略按确认规则执行。

---

## 迭代 C：同城配送

### C1 数据模型与迁移

- [x] 新增 `Delivery`（orderId 唯一、storeId、status、配送员、接单/送达时间、备注）
- [x] 迁移 `20xxxxxx_deliveries`（只增不毁）
- [x] `StoreDeliveryRegion` 与门店配送配置启用

### C2 配送规则

- [x] `packages/shared` 增加配送费纯函数：固定配送费、满额免配送费、会员包邮不生效
- [x] 门店配送区县白名单校验
- [x] 配送时段、截单时间、每时段最大单量校验
- [x] 单测覆盖固定费、满额免、会员包邮、时段容量

### C3 配送下单

- [x] `orders/preview` 支持 `fulfillmentType=DELIVERY`、`storeId`、`deliverySlot`
- [x] 范围外不可选并提示原因
- [x] 运费写入 `freightCents`；下单写入 `fulfillmentType`、`storeId`
- [x] 支付成功创建 `Delivery`（`PENDING`）

### C4 配送状态与接口

- [x] `packages/shared` 增加 `accept_delivery`（`PAID → SHIPPED`）、`deliver_complete`（`SHIPPED → COMPLETED`）
- [x] `GET /admin/deliveries?status=&storeId=&date=`
- [x] `POST /admin/deliveries/:id/accept`（配送员姓名/电话）
- [x] `POST /admin/deliveries/:id/deliver`
- [x] `POST /admin/deliveries/:id/cancel`（仅 PENDING/ACCEPTED，需原因）
- [x] 门店账号只能操作授权门店配送单

### C5 通知

- [x] 入队 `DELIVERY_ACCEPTED`、`DELIVERY_DONE`
- [x] 集成配置补充模板 ID 说明

### C6 后台页面

- [x] 新增 `apps/admin/src/pages/Deliveries.tsx`
  - 待接单、配送中、已送达、超时
  - 接单、送达、取消
  - 门店筛选与日期筛选
- [x] `App.tsx` 路由 `/fulfillment/deliveries`
- [x] `Layout.tsx` 菜单「履约 → 同城配送」

### C7 小程序

- [x] 结算页开放「同城配送」，选择配送时段
- [x] 订单详情展示配送状态、配送员信息、预计送达时段
- [x] 支持联系配送员

### C8 看板

- [x] 门店看板增加平均接单时长、平均送达时长、超时单数
- [x] 配送超时可在列表识别

### C9 测试与验收

- [x] 新增 `apps/api/test/contract/delivery.contract.test.ts`
- [x] E2E：H5 配送下单 → 支付 → 接单 → 送达 → 完成
- [x] 验收：范围外 100% 拦截；配送费准确率 100%；状态与权限正确
- [x] `pnpm verify` + `pnpm test:e2e` 全绿

完成标准：同城配送从下单到送达闭环可用；配送费与时段规则有单测；超时可识别。

---

## 迭代 D：全文搜索与经营完善

### D1 搜索数据与索引

- [ ] 迁移 `20xxxxxx_search`：`CREATE EXTENSION IF NOT EXISTS pg_trgm`
- [ ] `Product.searchText String @default("")`
- [ ] 创建 GIN 索引（Prisma 或原生 SQL）
- [ ] 商品保存时生成 `searchText`（标题、副标题、标签、分类、拼音）

### D2 拼音与回填

- [ ] API 依赖增加 `pinyin-pro`
- [ ] 新增搜索文本生成工具与单测
- [ ] 新增历史商品回填脚本
- [ ] 回填后校验空 `searchText` 数量为 0

### D3 搜索查询

- [ ] `apps/api/src/prisma/search.ts` 实现 trigram 查询与相关度排序
- [ ] `GET /api/products` 支持 `keyword`、`priceMinCents`、`priceMaxCents`、`tagId`、`storeId`、`sort=new`
- [ ] 单字符关键词降级 `ILIKE`
- [ ] 结果分页稳定，保持现有响应结构

### D4 搜索统计

- [ ] 新增 `SearchLog`（keyword、resultCount、userId、createdAt）
- [ ] `GET /admin/search/stats`：搜索词 Top、无结果词 Top
- [ ] 热词由日志自动聚合，不提供人工维护
- [ ] 后台经营看板展示搜索统计

### D5 小程序搜索页

- [ ] 搜索历史（本地存储）
- [ ] 热词展示（接口聚合）
- [ ] 筛选栏：分类、价格区间、标签
- [ ] 排序：综合、销量、价格、新品
- [ ] 无结果推荐同分类热销

### D6 性能与验收

- [ ] 1 万 SKU 基准数据准备脚本（本地）
- [ ] 搜索 P95 < 300ms
- [ ] 2 字中文样本召回 ≥ 95%，拼音首字母可召回
- [ ] 回归分类页、首页推荐、商品详情

### D7 测试与验证

- [ ] 新增 `apps/api/test/contract/search.contract.test.ts`
- [ ] 单测：搜索文本生成、相关度排序、单字降级
- [ ] `pnpm verify` + `pnpm test:e2e` 全绿

完成标准：中文与拼音可搜；筛选排序正确；性能达标；搜索统计可在后台查看。

---

## 三期完成标准

- 三种履约方式（快递 / 同城配送 / 到店自提）均可完成下单到完成闭环。
- 门店库存、订单归属、门店看板与日结对账可用，门店账号数据隔离。
- 自提核销幂等、安全、可追溯；超时按确认规则自动完成。
- 搜索支持中文、拼音、筛选与排序，性能达标。
- `pnpm verify` 与 `pnpm test:e2e` 全绿；openapi、迁移、文档同步完成。
- 真实支付真机验收与储值合规仍作为上线前置，不混入功能迭代。
