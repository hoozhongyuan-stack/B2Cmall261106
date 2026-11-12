# 积分商城 提案

> 需求：后台添加积分商品并设置兑换价格，支持纯积分与「积分 + 钱」；每人限兑；小程序新增积分商城页（顶部积分余额与明细入口、下方瀑布流商品）。
> 原则：复用现有商品、订单、支付、库存与履约能力，不另起一套发货体系；积分商品不进入普通商城、购物车、优惠券与秒杀。

**已确认决策**

1. 积分商品复用现有商品与 SKU，支持多规格与库存共享。
2. 兑换订单统一包邮，兑换价即最终价。
3. 用户端不开放兑换订单售后；后台支持整单退款，退款时返还积分并回补库存。

---

## 一、现状与可复用能力

| 能力 | 现状 | 复用方式 |
| --- | --- | --- |
| 商品/SKU/库存 | `Product` + `Sku`（多规格、库存、上下架、图片） | 增加「积分渠道」与兑换价字段，复用库存与商品编辑 |
| 订单 | `Order` + `OrderItem`，含地址、配送/自提、发货、超时关闭 | 增加订单类型与积分字段，复用履约与后台订单 |
| 支付 | 微信 JSAPI / mock，`Payment` 幂等回调 | 积分+钱复用；纯积分走 0 元支付单直接完成 |
| 积分 | `User.points` + `PointsLedger`，已有签到/分享/订单发放 | 新增兑换扣减与退回流水 |
| 小程序 | 已有积分页 `pages/points`、商品详情、订单列表 | 新增积分商城页与兑换详情页 |
| 后台 | 商品编辑、订单列表、角色权限 | 积分商品列表 + 商品编辑新增积分区块 |

**约束**：当前积分只做获取，不做普通订单抵扣；本次仅新增「积分兑换商品」，普通订单仍不能使用积分抵扣。

---

## 二、方案选择

### 方案 A（推荐）：复用商品与订单主干

- `Product` 增加「积分渠道」，`Sku` 增加兑换积分与加价金额。
- 兑换单复用 `Order`，享受现有地址、运费、发货、超时关闭、后台订单列表。
- 改动集中在：商品字段、下单分支、积分流水、前端两个页面；不复制履约体系。

### 方案 B：独立积分商品 + 独立兑换单

- 新建 `PointsGoods` / `PointsOrder` 表，不动普通商品与订单。
- 优点：隔离彻底；缺点：地址、发货、超时、退款、后台订单全部要重写一遍，后续维护两套履约。

**结论**：采用方案 A。积分商品用 `channel=POINTS` 与普通商品区分，所有普通渠道查询默认排除。

---

## 三、数据模型

```prisma
enum ProductChannel {
  NORMAL
  POINTS
}

model Product {
  // ...原字段
  channel           ProductChannel @default(NORMAL)
  /// 每人限兑数量；0 表示不限
  pointsLimitPerUser Int           @default(0)
}

model Sku {
  // ...原字段
  /// 兑换所需积分（每件）；null 表示该规格不参与兑换
  pointsCost       Int?
  /// 积分 + 钱时的加价金额（分/件），纯积分填 0
  pointsMoneyCents Int  @default(0)
}

model Order {
  // ...原字段
  orderType  String @default("NORMAL") // NORMAL | POINTS
  /// 本单消耗积分
  pointsUsed Int    @default(0)
}

model OrderItem {
  // ...原字段
  /// 兑换单的单价积分快照
  pointsCost Int @default(0)
}

/// 每人限兑计数器：并发下保证不超限
model PointsMallQuota {
  id        String @id @default(cuid())
  userId    String
  productId String
  usedQty   Int    @default(0)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  @@unique([userId, productId])
}
```

- `PointsLedger.source` 新增 `EXCHANGE`（兑换扣减）、`EXCHANGE_REFUND`（取消/退款返还）。
- 积分商品仍使用 `Sku.priceCents` 存「加价金额」，纯积分时为 0；普通列表用积分价展示，不读取 `priceMinCents`。
- 迁移：现有商品/订单全部默认 `NORMAL`，不影响存量数据。

---

## 四、后台

### 4.1 商品编辑新增「积分兑换」

在 [ProductEdit.tsx](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/admin/src/pages/ProductEdit.tsx) 增加一张卡：

- 兑换开关：开启后商品渠道为 `POINTS`，不再进入普通商城。
- 每人限兑：数字，0 表示不限。
- 每个 SKU 两个输入：兑换积分（必填）、加价金额（元，可 0）；多规格分别设置。
- 校验：
  - 至少一个 SKU 设置积分；
  - 纯积分时加价必须为 0；积分 + 钱时加价 > 0；
  - 兑换积分 ≥ 1，限兑 ≥ 0。
- 普通商品编辑页不显示该卡；积分商品保存时跳过「价格必须大于 0」的旧校验。

### 4.2 新增「营销 → 积分商城」列表

- 路由 `/marketing/points-mall`，权限新增 `pointsmall.view` / `pointsmall.manage`。
- 列表列：商品图与标题、兑换价（`1200 积分` / `1000 积分 + ¥9.9`）、库存、已兑、每人限兑、状态、排序、操作。
- 顶部「添加积分商品」→ 打开商品编辑页并预置积分渠道；操作「编辑 / 上下架」。
- 空态引导：先创建商品并开启积分兑换。

### 4.3 订单

- 后台订单列表/详情增加「积分兑换」标签与消耗积分；发货、备注、导出逻辑不变。
- 兑换单不参与优惠券、会员折扣、满减、秒杀；金额仅为加价部分。
- P1 兑换单不开放用户售后入口；如需退款，后台整单退款时同时返还积分、回补库存（P2 完善部分退款）。

---

## 五、接口设计

### 5.1 公开/会员接口

| 接口 | 说明 |
| --- | --- |
| `GET /points-mall/products?page&pageSize` | 积分商品列表（仅上架、有库存），返回积分价、加价、库存、限兑 |
| `GET /products/:id` | 详情补充 `channel`、`pointsLimitPerUser`、SKU `pointsCost/pointsMoneyCents`；普通详情页按渠道分支渲染 |
| `POST /member/points-mall/orders` | 兑换下单，需 `Idempotency-Key`；入参 `skuId、quantity、addressId、fulfillmentType、storeId…`；返回 `orderId、orderNo、payableCents、pointsUsed、payParams?` |
| `GET /member/points-mall/limits?productId=` | 当前用户已兑 / 剩余可兑（详情页展示，可选） |

### 5.2 下单流程（事务内）

1. 校验商品 `channel=POINTS`、SKU 可兑换、上架、库存充足。
2. 计算 `pointsCost × quantity`、`moneyCents × quantity`；校验余额。
3. 限兑：`PointsMallQuota` 原子累加，超过 `pointsLimitPerUser` 返回 409「每人限兑 N 件，已兑 M 件」。
4. 扣积分：`User.points` 条件更新（`points >= cost`），写 `PointsLedger(EXCHANGE, -cost, orderId)`；余额不足 400。
5. 锁 SKU、扣库存（复用现有 `reserved` 机制），创建 `Order(orderType=POINTS, pointsUsed, goodsCents=加价总额, payableCents=加价总额)` 与 `OrderItem(pointsCost 快照)`。
6. 纯积分（`payableCents=0`）：创建 `Payment(provider='points', amount=0, status=SUCCESS)`，订单直接进入已支付；不发放消费积分。
7. 积分 + 钱：复用现有支付下单，返回微信支付参数；支付成功回调沿用 `markPaid`，但 `orderType=POINTS` 时跳过消费积分发放。
8. 取消 / 超时关闭：回补库存、返还积分（`EXCHANGE_REFUND`）、回退限兑计数；复用现有超时任务与取消接口。

### 5.3 边界

- 兑换单不参与：优惠券、会员折扣、满减、秒杀、运费券。
- 运费：**P1 统一包邮**，兑换价即最终价；后续可加「是否包邮 / 运费模板」。
- 积分发放：兑换单不产生消费积分，避免「积分换积分」循环。
- 普通商品列表、分类、搜索、购物车、秒杀全部排除 `channel=POINTS`。
- 商品下架或库存为 0 时，积分商城不展示；详情页提示「已兑完 / 已下架」。

---

## 六、小程序页面

### 6.1 积分商城 `/pages/points-mall/index`

- 顶部积分卡：当前积分、**明细入口**（跳 `/pages/points/index`）、「我的兑换」（订单列表按 `orderType=POINTS` 过滤）。
- 下方瀑布流：
  - 两列 CSS `columns: 2`，卡片 `break-inside: avoid`，图片 `mode="widthFix"` 形成高低错落。
  - 卡片内容：商品图、标题、兑换价（`1200 积分` 或 `1000 积分 + ¥9.9`）、库存/限兑标签。
  - 下拉刷新 + 上拉加载；空态「积分商品正在上架中」；加载骨架复用 `PageState`。
- 入口：
  - 积分页顶部「积分商城」按钮；
  - 我的页面功能入口；
  - 微页面链接选项新增「积分商城」（可选）。

### 6.2 兑换详情 `/pages/points-product/index?id=`

- 复用商品图轮播与详情图，展示：积分价、加价、库存、每人限兑与已兑进度。
- 数量步进器（不超过库存与剩余限兑）。
- 履约：实物默认快递，需要收货地址；可选门店自提（复用现有履约选择）。
- 底部按钮：
  - 纯积分：「立即兑换」→ 确认弹窗 → 成功页；
  - 积分 + 钱：「立即兑换」→ 微信支付 → 支付结果页。
- 积分不足时按钮置灰并提示「还差 N 积分」。

### 6.3 记录

- 「我的兑换」复用订单列表，增加「兑换」筛选标签；订单详情展示消耗积分与加价金额。
- 积分明细新增来源「积分兑换」「兑换退回」。

---

## 七、实施顺序

1. 数据模型与迁移：渠道、兑换价、限兑、订单类型、积分流水来源、限兑计数表。
2. 商品接口：普通渠道排除积分商品；详情补充积分字段；购物车/秒杀拦截积分 SKU。
3. 后台：商品编辑积分区块 + 积分商城列表 + 权限与菜单。
4. 兑换服务：事务下单、积分扣减、限兑、纯积分自动完成、积分+钱支付。
5. 取消/超时/退款：库存、积分、限兑回退；订单列表与积分流水来源展示。
6. 小程序：积分商城瀑布流、兑换详情、支付结果、入口与订单筛选。
7. 测试：契约、E2E、权限矩阵、`pnpm verify`。

---

## 八、验收标准

| 项 | 标准 |
| --- | --- |
| 后台配置 | 商品可开启积分兑换，按 SKU 设置积分与加价、每人限兑；普通商品列表不再出现该商品 |
| 纯积分兑换 | 扣减积分与库存，生成已支付兑换单，积分流水出现「积分兑换」 |
| 积分 + 钱 | 生成待支付订单，微信支付后完成；金额只含加价部分，不参与优惠 |
| 限兑 | 超过每人限兑数量返回 409；并发下单不会超限 |
| 余额不足 | 返回 400「积分不足」，不产生订单与流水 |
| 库存 | 下单预占、取消/超时/退款回补，不超卖 |
| 前端 | 积分商城显示余额、明细入口与瀑布流；详情可兑换；入口可达 |
| 数据隔离 | 普通商城列表、搜索、购物车、秒杀均看不到积分商品 |
| 工程 | `pnpm verify` 全绿；新增契约与 E2E；openapi 与 api-types 同步 |

---

## 九、不做（P1）

- 积分抵扣普通订单（仍保持「仅获取」）。
- 积分有效期、积分转让、积分兑换优惠券。
- 积分商品多件合并支付、购物车。
- 兑换单部分退款/售后；P1 仅支持后台整单退款并返还积分。
- 虚拟商品自动发码、预约核销。
- 运费模板与积分商品包邮开关（P1 统一包邮）。

---

## 十、风险

| 风险 | 应对 |
| --- | --- |
| 复用订单影响普通下单 | 兑换走独立服务与 `orderType=POINTS` 分支，普通下单代码不变；回归全量 E2E |
| 并发超兑 / 超卖 | 限兑计数表原子更新；SKU 行锁与 `reserved` 复用 |
| 取消/退款漏返积分 | 统一封装 `releaseExchange(orderId)`，在取消、超时、整单退款三处调用 |
| 积分商品混入普通渠道 | 所有普通查询统一 `channel=NORMAL` 条件；契约测试校验 |
| 角色权限遗漏 | 权限目录新增 `pointsmall.view/manage`，迁移时为商品运营/客服补默认权限 |
