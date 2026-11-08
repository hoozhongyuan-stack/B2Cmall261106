# 三期迭代 A–D 规格：履约与到店 / 轻量多门店 / 全文搜索

状态：已规划，待实现（本地开发，不部署云服务器）
依据：[三期规划](../../planning/phase-3.md)
迭代顺序：A 门店与库存底座 → B 到店自提与核销 → C 同城配送 → D 全文搜索与经营完善

已确认规则：
- 自提超时：按门店配置 N 天（默认 7 天），到期前提醒，到期**自动完成订单**，不自动退款。
- 配送时段：门店必须配置每日时段、截单时间与每时段最大单量。
- 会员包邮：仅作用于快递；同城配送按门店配送费规则，自提运费为 0。
- 门店账号：一个账号可管理多个门店（`AdminStore` 多对多）。
- 搜索热词：只做日志统计与自动聚合，不做人工运营。

---

## 1. 目标

1. 同城配送与到店自提成为与快递并列的履约方式，订单、库存、退款、售后按履约方式正确分流。
2. 轻量多门店：门店级可售库存、订单归属、门店账号数据隔离、门店看板与日结对账。
3. 商品搜索支持中文关键词、拼音首字母、分类/价格/标签筛选与多维排序。
4. 所有金额、状态与权限规则有单测或契约测试；延续工程契约 R1–R6。

## 2. 非目标

- 不做多商家入驻、平台抽佣、门店独立收款与分账。
- 不接第三方即时配送（达达/蜂鸟/顺丰同城），不做骑手调度。
- 不做地图选点、按真实距离计算配送范围与运费；配送范围用区县白名单。
- 不迁 OSS/CDN，不引入 Meilisearch/Typesense 等外部搜索服务。
- 不做商品批量导入导出、在线客服、发票（三期候选，不排期）。
- 不改变快递主链路、秒杀、会员折扣、优惠券、满减的既有规则。

---

## 3. 前置质量门禁（一二期）

### 3.1 执行结果

| 检查项 | 命令 | 结果 |
|---|---|---|
| 静态契约 | `pnpm lint` | 通过（裸色值 / 魔法字号 / 跨层 import / 原生 SQL 位置） |
| 类型检查 | `pnpm typecheck` | 通过（shared / api / admin / miniapp / api-types） |
| 单测与覆盖率 | `pnpm test:coverage` | 66 条通过；shared 行 98.63%、分支 95.04%、函数 95.23% |
| 迁移可执行性 | 契约测试启动时 `prisma migrate reset` | 15 个迁移在空库全部执行成功 |
| 接口契约 | `pnpm test:contract` | 8 个文件、64 条通过 |
| codegen 同步 | `pnpm prepare:types` 前后对比 | `packages/api-types/src/schema.d.ts` 哈希不变 |
| 构建 | `pnpm build:api` / `pnpm build:web` | 通过；H5 仅体积告警 |
| E2E | `pnpm test:e2e` | 5 条通过（后台登录、集成配置、小程序发布页、H5 下单支付） |
| TODO 扫描 | `rg TODO/FIXME` | 0 条 |
| 数据契约 | schema 检查 | 金额字段均为 `*Cents`；72 处 `DateTime` 均为 `@db.Timestamptz(3)` |
| 敏感文件 | `git ls-files` / `.gitignore` | `.env`、上传密钥目录未入库 |

### 3.2 本次门禁修复

1. **E2E 数据隔离**：`admin-miniapp-release.spec.ts` 原先强依赖「无发布记录」，本地已有记录时误报；改为有记录校验版本表、无记录校验空态。
2. **E2E 商品选择**：`h5-order.spec.ts` 原先固定取第一个商品，本地秒杀活动会把该商品变成限购商品，导致 409；改为遍历商品详情，选择未参与秒杀且有库存的商品。
3. **原生 SQL 收敛**：按工程契约 R4，将 `order.service.ts` 的 SKU 行锁与 `coupon.service.ts` 的领券原子扣减收敛到 `apps/api/src/prisma/queries.ts`，并在 ESLint 增加 `$queryRaw/$executeRaw` 位置规则。
4. **时间列迁移漂移修正**：历史迁移把 `IntegrationConfig.updatedAt`、`MiniappRelease.createdAt/updatedAt` 建成 `TIMESTAMP(3)`，与 schema 的 `@db.Timestamptz(3)` 不一致，导致 `prisma migrate dev` 判定 drift；已在 `20261107215317_stores` 中统一为 `TIMESTAMPTZ(3)`，并在空测试库验证 16 个迁移全部成功。

### 3.3 已知偏差（不阻塞，进入三期跟踪）

| 偏差 | 说明 | 处理 |
|---|---|---|
| 历史迁移删列 | `20261106160000_integration_app_secret_text` 删除 AppSecret 文件指针列，未回填 | 迁移已应用且无生产数据；三期起严格「加字段 → 回填 → 下一发布弃用」，新迁移不得删列 |
| 状态规则覆盖不全 | ESLint 只拦 `===`，未拦 `!==`；现有 2 处为支付/售后守卫，不是状态机迁移 | 迭代 A 评估把规则扩展到 `!==`，或将守卫改为 `can()` 判断 |
| 契约覆盖非全量 | 64 条契约覆盖主链路，未覆盖 openapi 全部 116 个路径 | 三期新增/修改接口必须补契约测试，验收时按路径清单核对 |

### 3.4 结论

`pnpm verify` 与 E2E 全部通过，一二期质量符合工程契约，可以进入三期迭代 A。

---

## 4. 全局设计

### 4.1 履约方式

`Order.fulfillmentType`：`EXPRESS`（默认，兼容历史订单）、`DELIVERY`、`PICKUP`。

| 履约方式 | 库存来源 | 运费 | 主状态流转 | 后台操作 |
|---|---|---|---|---|
| `EXPRESS` | 总部仓 `Sku.stock/reserved` | 现有满额包邮 + 区域例外 | `PAID → SHIPPED → COMPLETED` | 批量发货、物流单号 |
| `DELIVERY` | 门店 `StoreSku.stock/reserved` | 门店固定配送费，满额免配送费；会员包邮不生效 | `PAID → SHIPPED（配送中）→ COMPLETED（已送达）` | 接单、送达、取消 |
| `PICKUP` | 门店 `StoreSku.stock/reserved` | 0 | `PAID（待自提）→ COMPLETED（已核销/自动完成）` | 核销台、核销记录 |

- 前端文案按履约方式渲染，状态机本身不新增主状态。
- 自提订单不生成 `Shipment`；配送订单使用 `Delivery`；快递继续使用 `Shipment`。

### 4.2 门店与权限

```prisma
enum AdminRole {
  SUPER
  OPS
  CS
  WMS
  STORE
}

model Store {
  id                        String   @id @default(cuid())
  code                      String   @unique
  name                      String
  phone                     String?
  region                    String
  address                   String
  lat                       Float?
  lng                       Float?
  businessHours             Json     @default("{}")
  pickupEnabled             Boolean  @default(false)
  deliveryEnabled           Boolean  @default(false)
  deliveryFeeCents          Int      @default(0)
  freeDeliveryThresholdCents Int     @default(0)
  deliverySlots             Json     @default("[]")
  deliveryCutoff            String?
  maxOrdersPerSlot          Int      @default(0)
  pickupCompleteDays        Int      @default(7)
  notice                    String?
  status                    String   @default("ACTIVE")
  sort                      Int      @default(0)
  createdAt                 DateTime @default(now()) @db.Timestamptz(3)
  updatedAt                 DateTime @updatedAt @db.Timestamptz(3)
}

model AdminStore {
  id          String @id @default(cuid())
  adminUserId String
  storeId     String

  @@unique([adminUserId, storeId])
  @@index([storeId])
}
```

- 总部角色（SUPER/OPS/CS/WMS）默认全部门店可见；`STORE` 只能访问 `AdminStore` 授权门店。
- 后台顶部提供门店切换器；无门店授权的 `STORE` 账号登录后提示联系管理员。
- 数据范围在 service 层强制过滤；越权返回 404，不泄露其他门店数据。
- 门店账号可执行：本店订单查看、核销、本店库存调整、本店看板与对账；不可改价、建活动、查看资金总账。

### 4.3 库存模型（双轨隔离）

```prisma
model StoreSku {
  id          String @id @default(cuid())
  storeId     String
  skuId       String
  stock       Int    @default(0)
  reserved    Int    @default(0)
  safetyStock Int    @default(0)
  status      ProductStatus @default(ON_SALE)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([storeId, skuId])
  @@index([skuId])
}

model StoreStockLog {
  id         String   @id @default(cuid())
  storeId    String
  skuId      String
  delta      Int
  beforeStock Int
  afterStock Int
  reason     String
  orderId    String?
  operatorId String?
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  @@index([storeId, createdAt])
  @@index([skuId])
}
```

- 快递只扣总部仓，自提/配送只扣门店库存；两者不自动同步。
- 门店库存扣减使用条件更新，防止并发超卖：

```ts
const reserved = await tx.storeSku.updateMany({
  where: {
    storeId,
    skuId,
    status: 'ON_SALE',
    stock: { gte: quantity },
    reserved: { lte: stock - quantity },
  },
  data: { reserved: { increment: quantity } },
});
if (reserved.count !== 1) {
  throw new ConflictException('门店库存不足，请切换门店或改为快递');
}
```

- 取消、超时关单、退款按订单行来源仓回滚；门店库存不足时前端引导切换门店或快递。
- 总部到门店调拨、盘点放 P1，不进入 A。

### 4.4 金额与运费

- `calculateOrderAmount` 的优惠链路不变：商品 → 会员折扣（取最优）→ 优惠券 → 满减 → 运费。
- 运费来源：
  - `EXPRESS`：沿用 `buildFreight`（满额包邮 + 区域例外）。
  - `PICKUP`：`freightCents = 0`。
  - `DELIVERY`：门店固定配送费；商品金额（会员折扣后）达到门店免配送门槛时为 0；会员包邮不生效。
- 配送费规则放入 `packages/shared`，新增纯函数与单测，避免在页面/Controller 复制门槛判断。
- 秒杀行、优惠券、满减不因履约方式改变；自提/配送与秒杀组合必须补单测。

### 4.5 状态机新增动作

在 [orderState.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/packages/shared/src/orderState.ts) 增加：

| 动作 | 迁移 | 使用方 |
|---|---|---|
| `accept_delivery` | `PAID → SHIPPED` | 门店接单/配送中 |
| `deliver_complete` | `SHIPPED → COMPLETED` | 门店标记已送达 |
| `pickup_verify` | `PAID → COMPLETED` | 核销台或自提超时自动完成 |

- 所有新增动作补 `orderState.test.ts`，禁止业务代码手写状态判断。
- `buyerActions` 按履约方式派生展示：自提订单不展示「确认收货」，配送订单由门店完成。

### 4.6 通知

复用二期 [notification.service.ts](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/api/src/modules/notification/notification.service.ts) 的 Outbox：

| 场景 | 触发 |
|---|---|
| `PICKUP_READY` | 自提订单支付成功，核销码生成 |
| `PICKUP_EXPIRING` | 自提到期前 1 天 |
| `DELIVERY_ACCEPTED` | 门店接单 |
| `DELIVERY_DONE` | 门店标记送达 |

模板 ID 继续存 `IntegrationConfig.subscribeTemplateIds`，不新增表；缺模板时记 `SKIPPED`。

---

## 5. 迭代 A：门店与库存底座

### 5.1 数据模型与迁移

- 新增 `Store`、`AdminStore`、`StoreSku`、`StoreStockLog`、`StoreDeliveryRegion`（C 使用，可同迁移建表）。
- `Order` 增加：
  ```prisma
  fulfillmentType String @default("EXPRESS")
  storeId         String?
  pickupCode      String? @unique
  pickupAt        DateTime? @db.Timestamptz(3)
  pickupCodeExpiresAt DateTime? @db.Timestamptz(3)
  ```
- `AdminRole` 增加 `STORE`。
- 迁移命名 `20261107215317_stores`；只新增表/可空列，不删列；唯一的类型调整是修正历史迁移的时间列漂移。
- 历史订单默认 `EXPRESS`、`storeId = null`，无需回填业务字段。

### 5.2 后端

新增 `apps/api/src/modules/store/`：
- `store.service.ts`：公开门店列表/详情、后台门店 CRUD、启停、排序。
- `store-stock.service.ts`：门店库存查询、单 SKU 调整、批量设置、库存流水。
- `store-inventory.service.ts`：下单预占、取消释放、支付扣减、退款回补的事务助手。
- `store.controller.ts`：`GET /stores`、`GET /stores/:id`。
- `store-admin.controller.ts`：`GET/POST /admin/stores`、`GET /admin/stores/mine`、`PATCH/DELETE /admin/stores/:id`。
- `store-stock.controller.ts`：`GET/PATCH /admin/stores/:storeId/skus`、`POST .../skus/batch`、`GET .../stock-logs`。
- `store-scope.service.ts`：解析 `{ all, storeIds }`；总部全量，门店账号按 `AdminStore` 授权。

订单改造（A3 已完成）：
- `order.service.ts` 的 `fulfillmentType` 默认 `EXPRESS`；`create` 按方式选择库存来源，A 阶段接口已支持自提/配送但前端入口暂不开放（灰度）。
- 门店订单不锁总部仓 SKU 行，由 `StoreSku` 条件更新防超卖；门店库存预占放在事务末尾，缩短行锁持有时间。
- `cancel`、`order-timeout.service.ts`、退款回滚按来源仓释放/回补。
- `view` 返回 `fulfillmentType`、`storeId`、`storeName`；`pickupCode` 在 B 阶段接入。

### 5.3 后台页面

- 新增 `apps/admin/src/pages/Stores.tsx`：门店列表、编辑、启停、营业时间、自提/配送开关、配送费与门槛、配送区县、时段与截单。
- 新增门店库存子页或抽屉：SKU 搜索、可售/预留/安全库存、批量调整、库存流水。
- `Layout.tsx` 增加「门店 → 门店管理」；总部账号可见。
- 订单列表增加门店与履约方式筛选；门店账号默认锁定本店。
- 门店看板 v1：今日订单、营业额、退款、待核销、待配送、库存预警。

### 5.4 测试

- 契约（已完成）：门店 CRUD、门店库存查询/调整/批量/流水、50 并发抢 10 件、取消释放、支付扣减、退款回补、门店账号越权 404。
- 待 A4 补齐：后台订单列表的门店/履约方式筛选与门店账号订单范围。
- E2E：总部创建门店并设置库存；门店账号登录只看到本店订单。

### 5.5 验收

- 门店可创建并配置营业时间、自提/配送能力、配送区县与时段。
- 门店库存独立扣减与回滚，无负库存。
- 门店账号无法读取未授权门店的订单、库存与看板。
- 门店看板数字与订单明细一致。
- 快递主链路回归通过。

---

## 6. 迭代 B：到店自提与核销

### 6.1 数据模型

```prisma
model PickupVerification {
  id         String   @id @default(cuid())
  orderId    String   @unique
  method     String   // CODE | QR | AUTO
  verifiedBy String?  // 管理员 id；AUTO 为空
  verifiedAt DateTime @default(now()) @db.Timestamptz(3)
  note       String?

  @@index([verifiedAt])
}
```

`Order.pickupCode` 支付成功后生成，8 位随机数字，唯一索引；`pickupCodeExpiresAt` 按门店 `pickupCompleteDays` 计算。

### 6.2 下单与金额

- 结算预览入参增加 `fulfillmentType`、`storeId`、`pickupSlot`；自提时 `region` 可不传。
- 校验：门店存在且 `pickupEnabled`、营业中、时段可用、门店有库存。
- 自提运费 0；`addressSnapshot` 存门店快照（门店名、地址、电话、时段）与用户手机号，避免改表。
- 下单成功生成待支付订单；支付成功后生成核销码并入队 `PICKUP_READY`。

### 6.3 核销

- 后台 `POST /admin/pickups/verify`，入参 `{ code }`。
- 校验顺序：门店授权 → 订单 `PAID` → `PICKUP` → 未退款 → 码未过期 → 未核销。
- 重复核销返回「已核销」及核销信息，不报错；跨门店核销返回 404。
- 核销成功后：订单 `COMPLETED`、写 `PickupVerification`、操作日志、积分发放、评价入口开放。
- 核销码在取消、退款、超时关单后失效。

### 6.4 超时自动完成

- 新增 `PickupTimeoutService`，每 10 分钟扫描 `PICKUP + PAID + pickupCodeExpiresAt < now`。
- 到期前 1 天入队 `PICKUP_EXPIRING`（每天最多一次）。
- 到期执行 `pickup_verify`，`method = AUTO`，订单完成；不回滚库存、不退款。
- 自动完成写操作日志，后台可筛选 `AUTO` 记录。

### 6.5 后台与小程序

- 后台新增 `Pickups.tsx`：待核销列表、扫码/输码核销、核销记录、按门店筛选。
- 小程序：
  - 结算页选择「到店自提」→ 门店选择页 → 自提时段。
  - 订单详情展示核销码、二维码、门店地址、营业时间、剩余时间。
  - 门店列表支持按区域筛选与距离展示（有经纬度时）。

### 6.6 测试与验收

- 单测：核销码校验顺序、重复核销幂等、超时自动完成、退款后码失效。
- 契约：自提预览/下单/核销/退款、跨门店核销拒绝、门店账号仅本店。
- E2E：H5 自提下单 → 支付 → 后台核销 → 订单完成。
- 验收：支付后立即出码；核销 P95 < 2s；重复/跨店/已退款核销 0 发生；自提订单无地址与快递单号。

---

## 7. 迭代 C：同城配送

### 7.1 数据模型

```prisma
model StoreDeliveryRegion {
  id         String @id @default(cuid())
  storeId    String
  regionName String

  @@unique([storeId, regionName])
  @@index([storeId])
}

model Delivery {
  id           String    @id @default(cuid())
  orderId      String    @unique
  storeId      String
  status       String    @default("PENDING") // PENDING | ACCEPTED | DELIVERED | CANCELLED
  courierName  String?
  courierPhone String?
  acceptedAt   DateTime? @db.Timestamptz(3)
  deliveredAt  DateTime? @db.Timestamptz(3)
  remark       String?
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @db.Timestamptz(3)

  @@index([storeId, status])
}
```

### 7.2 规则

- 配送范围：收货地址 `region` 必须命中门店 `StoreDeliveryRegion`；否则结算页不可选并提示最近可配送门店。
- 配送时段：门店配置每日时段、截单时间、每时段最大单量；下单时校验已截单/已约满。
- 配送费：门店固定配送费；会员折扣后商品金额达到免配送门槛时为 0；会员包邮不生效。
- 配送单在支付成功后创建，状态 `PENDING`；门店接单后 `ACCEPTED`，订单 `PAID → SHIPPED`。
- 送达后 `DELIVERED`，订单 `SHIPPED → COMPLETED`，入队 `DELIVERY_DONE`。
- 配送中不直接退款：提示拒收或送达后走售后；P1 补拒收流程。

### 7.3 接口

- `GET /admin/deliveries?status=&storeId=&date=`
- `POST /admin/deliveries/:id/accept`（可带配送员姓名/电话）
- `POST /admin/deliveries/:id/deliver`
- `POST /admin/deliveries/:id/cancel`（仅 `PENDING/ACCEPTED`，需原因）

### 7.4 后台与小程序

- 后台 `Deliveries.tsx`：待接单、配送中、已送达、超时；接单与送达操作；门店筛选。
- 小程序订单详情展示配送状态、配送员信息、预计送达时段；支持联系配送员。
- 门店看板增加平均接单时长、平均送达时长、超时单数。

### 7.5 测试与验收

- 单测：配送费（固定/满额免/会员包邮不生效）、时段截单与容量、状态动作。
- 契约：配送预览/下单/接单/送达/取消、范围外 400、非本店操作 404。
- E2E：H5 配送下单 → 支付 → 后台接单 → 送达 → 订单完成。
- 验收：范围外 100% 拦截；配送费准确率 100%；超时单可在看板识别。

---

## 8. 迭代 D：全文搜索与经营完善

### 8.1 数据与索引

```prisma
model Product {
  /// 标题 + 副标题 + 标签 + 分类 + 拼音全拼/首字母
  searchText String @default("")

  @@index([searchText(ops: raw("gin_trgm_ops"))], type: Gin)
}
```

- 迁移执行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`；如 Prisma 索引语法受限，用原生 SQL 建 GIN 索引。
- 商品创建/更新时生成 `searchText`；新增回填脚本扫描历史商品。
- 拼音依赖 `pinyin-pro`，只在服务端使用。

### 8.2 搜索接口

扩展 `GET /api/products`：
- 参数：`keyword`、`categoryId`、`priceMinCents`、`priceMaxCents`、`tagId`、`storeId`、`sort`（`default | sales | price_asc | price_desc | new`）。
- 召回：`searchText % keyword`（trigram）；单字符降级 `ILIKE 'keyword%'`。
- 排序：相关度 `similarity(searchText, keyword)` + `soldCount` + `sort`。
- 原生 SQL 放在 `apps/api/src/prisma/search.ts`，业务层只做参数校验与结果拼装。
- 返回保持现有商品列表结构，新增 `highlight` 可选字段（P1）。

### 8.3 搜索页与统计

- 小程序搜索页：搜索历史（本地）、热词（按搜索日志聚合 Top 10）、筛选栏、无结果推荐（同分类热销）。
- `SearchLog` 记录关键词、结果数、用户、时间；后台只读统计，不提供人工热词配置。
- 后台经营看板增加搜索词 Top、无结果词 Top。

### 8.4 性能与验收

- 基准：1 万 SKU、5 万订单；搜索 P95 < 300ms。
- 验收：2 字中文样本召回 ≥ 95%；拼音首字母可召回；筛选与排序组合正确；分页稳定。
- 回归：分类页、首页推荐、商品详情不受影响。

---

## 9. 契约、迁移与完成定义

### 9.1 openapi 与 codegen

新增/变更接口必须同步 [openapi.yaml](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/openapi.yaml)，并执行：

```bash
pnpm codegen:api
pnpm prepare:types
```

`packages/api-types/src/schema.d.ts` 必须与 openapi 一致；契约测试按新路径补充。

### 9.2 迁移规则

- 只增不毁：新增表、可空列、索引；不在同一发布删列或改类型。
- 每个迭代一个迁移文件，命名 `20xxxxxx_stores`、`20xxxxxx_pickups`、`20xxxxxx_deliveries`、`20xxxxxx_search`。
- 契约测试在空库执行全部迁移，确保可重复。

### 9.3 DoD（每个迭代）

- 四态覆盖：空、错、载、禁；空态有出口，错误态写清下一步。
- 契约测试：新增/修改接口有响应校验；金额与状态有单测。
- 可观测：请求带 `requestId`，关键写操作日志含订单号/门店/操作人。
- 无遗留：不提交 TODO/FIXME 与注释代码。
- 契约同步：openapi、迁移、文档同一 PR 完成。

---

## 10. 验收总表

| 指标 | 目标 |
|---|---|
| 门店库存并发 | 50 并发抢 10 件成功恰为 10，无负库存 |
| 门店数据隔离 | 门店账号越权访问 0 发生 |
| 自提核销 | P95 < 2s；重复/跨店/已退款核销 0 发生 |
| 自提超时 | 到期自动完成，记录 `AUTO`，不产生退款 |
| 配送范围 | 范围外 100% 拦截 |
| 配送费 | 固定/满额免/会员包邮不生效，100% 准确 |
| 配送时效 | 接单、送达、超时可在看板查看 |
| 搜索召回 | 2 字中文 ≥ 95%，拼音首字母可召回 |
| 搜索性能 | 1 万 SKU、5 万订单下 P95 < 300ms |
| 回归 | 快递、秒杀、会员、优惠券、售后、评价全部通过 |

---

## 11. 风险与回滚

- **库存双轨**：以 `fulfillmentType` 唯一决定库存来源；回滚按订单行来源执行；契约测试覆盖取消、超时、退款、部分退款。
- **门店权限**：service 层强制过滤，越权返回 404；单独一组门店越权契约测试。
- **核销安全**：码随机、唯一、可失效；核销接口限流并记录操作人；禁止按订单号核销。
- **自提自动完成**：到期自动完成不可逆，需在上线前用真实文案告知用户；后台保留 `AUTO` 记录与操作日志。
- **配送范围**：区县白名单可能与真实距离不一致；若业务要求按公里计费，四期再评估地图服务。
- **搜索**：trigram 对单字弱，保留 `ILIKE` 降级；GIN 索引增加存储与写入成本，上线前压测。
- **回滚顺序**：D → C → B → A；每步保留功能开关（门店入口、配送入口、搜索开关），关闭开关即回到快递 + 旧搜索。

---

## 12. 上线前遗留（不计入三期功能）

- 真实微信支付真机支付与退款验收。
- 储值合规评估（退款、开票、资金存管口径）。
- 云端部署、HTTPS、回调域名与真机回归。
