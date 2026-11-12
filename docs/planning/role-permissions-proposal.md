# 角色与权限管理 提案

> 需求：PC 后台「账号」下新增「角色」子菜单，可自定义角色，并按项目勾选权限。
> 原则：权限目录单一来源；不预置业务角色，存量账号迁移后行为不变；后端鉴权为准、前端只做菜单与按钮显隐；接口按模块渐进迁移，不做大爆炸式改造。

---

## 一、现状盘点

### 1.1 固定 5 个角色

| 角色 | 名称 | PC 后台 | 说明 |
| --- | --- | --- | --- |
| `SUPER` | 超级管理员 | 可用 | 全部权限 |
| `OPS` | 商品运营 | 可用 | 商品、营销、装修为主 |
| `CS` | 客服 | 可用 | 订单查看、售后、客户 |
| `WMS` | 仓储 | 可用 | 库存、发货、核销、配送 |
| `STORE` | 门店 | **禁止登录 PC** | 仅小程序「我的 → 门店中心」 |

### 1.2 权限写在代码里的三处

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| 后端接口 | **148 处** `@Roles(...)`，如 `@Roles('SUPER','OPS')` | 新增角色必须改代码、发版 |
| 前端菜单 | [Layout.tsx](file:///Users/hoo/Documents/trae_projects/trae_B2C_1106/apps/admin/src/components/Layout.tsx) 每项写死 `roles: ['SUPER','OPS']` | 与后端两套规则，容易漂移 |
| 前端按钮/页面 | **35 处** `hasRole(...)` | 同样按角色枚举判断，无法组合 |

子账号页的角色下拉也写死 4 个角色，无角色管理入口。

### 1.3 现有能力边界

- 只能整角色授权，无法表达「能审核售后但不能发货」「能看订单不能退款」这类组合。
- 权限调整只能改代码；运营侧无法自助配置。
- 操作日志已覆盖后台写操作（`AdminAuditInterceptor`），角色变更可以直接复用。

---

## 二、目标与范围

| 能力 | P1 范围 |
| --- | --- |
| 角色管理 | 列表、新建、编辑、删除；名称 ≤20、描述 ≤200；独立页面，不用弹窗；**不预置任何业务角色，全部由后台自定义** |
| 权限配置 | 按 9 个分组勾选 58 个权限项；分组全选/半选；已选计数；级联规则 |
| 超级管理员 | 用账号级 `isSuper` 标记，绕过权限校验；系统保证至少一个启用中的超级管理员 |
| 门店账号 | 用账号类型 `kind=STORE` 标识，不再占用角色；PC 仍禁止登录，小程序门店中心不变 |
| 子账号 | 角色下拉改为接口数据；角色被占用时不可删除 |
| 鉴权 | 新增 `@Permission('order.ship')` 装饰器与 `PermissionGuard`，148 处旧 `@Roles` 已全量迁移 |
| 前端 | 登录返回权限列表；菜单、路由、按钮按权限显隐；直接访问无权限页面显示 403 |
| 审计 | 角色新增/修改/删除写操作日志 |

**不做（P1）**：数据范围权限（如「只看本门店订单」）、字段级权限、审批流、组织架构、小程序客户端权限、按账号单独授权（只按角色）。

---

## 三、权限模型

### 3.1 角色与账号

角色表不区分内置/自定义，全部可编辑、可删除（被占用时除外）：

```prisma
model AdminRoleDef {
  id          String      @id @default(cuid())
  name        String      @unique
  description String      @default("")
  permissions String[]    // 权限 key 列表
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  users       AdminUser[]
}

enum AdminUserKind {
  PC
  STORE
}

model AdminUser {
  // ...原字段
  kind    AdminUserKind @default(PC)
  isSuper Boolean       @default(false)
  roleId  String?
  roleDef AdminRoleDef? @relation(fields: [roleId], references: [id])
}
```

- **超级管理员**：`isSuper = true` 的账号跳过权限校验，用于首次接管与兜底；不能停用/删除最后一个启用中的超级管理员。
- **门店账号**：`kind = STORE`，不分配角色；PC 登录继续拒绝，小程序门店中心逻辑不变。
- **普通账号**：`kind = PC` 且 `isSuper = false`，必须绑定一个角色。
- 删除角色前校验是否仍有账号使用，占用时返回 409「该角色下还有 N 个账号」。
- 取消某角色的 `role.manage` 时前端二次确认，提示「该角色账号将无法再管理角色，超级管理员不受影响」。

### 3.2 权限目录（单一来源）

放在 `packages/shared/src/permissions.ts`，后端 Guard、种子数据、后台页面共用，避免三处漂移：

```ts
export const PERMISSION_GROUPS = [
  { key: 'data', name: '数据', items: [
    { key: 'dashboard.view', name: '数据概览' },
    { key: 'analytics.view', name: '经营看板' },
  ]},
  // ...
] as const;
```

**58 个权限项**（查看与写操作分开，避免只读角色获得写权限）：

| 分组 | 权限项 |
| --- | --- |
| 数据 | `dashboard.view` 数据概览、`analytics.view` 经营看板 |
| 商品 | `product.view` 商品查看、`product.edit` 商品编辑/上下架、`product.stock` 规格库存、`category.view` 分类查看、`category.manage` 分类管理、`tag.view` 标签查看、`tag.manage` 标签管理、`asset.view` 素材查看、`asset.manage` 素材管理 |
| 交易 | `order.view` 订单查看、`order.ship` 发货/批量发货、`order.refund` 退款处理、`order.edit` 订单备注/关闭超时、`aftersale.view` 售后查看、`aftersale.audit` 售后审核/确认收货、`review.manage` 评价管理 |
| 客户 | `customer.view` 客户查看、`customer.edit` 客户编辑/打标签/调积分、`usertag.view` 用户标签查看、`usertag.manage` 用户标签管理、`level.view` 等级规则查看、`level.manage` 等级规则管理、`membercard.view` 会员卡与储值查看、`membercard.manage` 会员卡与储值管理、`points.view` 积分规则查看、`points.manage` 积分规则管理 |
| 营销 | `coupon.view` 优惠券查看、`coupon.edit` 优惠券创建/编辑/发放、`promotion.view` 满减与秒杀查看、`promotion.manage` 满减与秒杀管理 |
| 门店履约 | `store.view` 门店查看、`store.edit` 门店新建/编辑/停用、`pickup.verify` 自提核销、`delivery.manage` 同城配送 |
| 装修 | `micropage.view` 页面装修查看、`micropage.manage` 页面装修管理、`tabbar.view` 底部导航查看、`tabbar.manage` 底部导航管理、`popupad.view` 弹窗广告查看、`popupad.manage` 弹窗广告管理 |
| 设置 | `shop.view` 店铺信息查看、`shop.manage` 店铺信息管理、`integration.view` 小程序与支付查看、`integration.manage` 小程序与支付管理、`notification.manage` 订阅消息测试/重试、`miniapp.view` 小程序发布查看、`miniapp.release` 小程序发布管理、`freight.manage` 运费模板、`express.view` 物流公司查看、`express.manage` 物流公司管理、`system.view` 系统状态 |
| 账号 | `account.view` 子账号查看、`account.manage` 子账号管理、`role.view` 角色查看、`role.manage` 角色管理、`log.view` 操作日志 |

**关键权限单独拆出**（不能并入「查看」）：`order.refund`、`aftersale.audit`、`coupon.edit`、`points.manage`、`shop.manage`、`integration.manage`、`miniapp.release`、`store.edit`、`account.manage`、`role.manage`。

**级联规则**：勾选写权限自动勾选对应查看项（如 `order.ship` → `order.view`）；取消查看项自动取消对应写权限。

### 3.3 存量账号迁移

| 原 `role` | 迁移后 |
| --- | --- |
| `SUPER` | `isSuper = true`，不绑定角色 |
| `OPS` | 新建普通角色「商品运营」，权限由现有 `@Roles` 自动推导；可改名、可删 |
| `CS` | 新建普通角色「客服」，同样自动推导；可改名、可删 |
| `WMS` | 新建普通角色「仓储」，同样自动推导；可改名、可删 |
| `STORE` | `kind = STORE`，不绑定角色 |

迁移只保证上线瞬间行为不变；后续这些角色都是普通自定义角色，运营可随时调整或删除（需先移出账号）。

### 3.4 鉴权流程

**后端**

- 登录返回：`{ token, user: { id, name, isSuper, role: { id, name } | null, permissions } }`。
- JWT 只放 `sub/account/roleId/isSuper`，不放权限数组，避免权限变更后 token 长期失效。
- `RolesGuard`（沿用类名，内部改为权限校验）：`isSuper` 直接放行；其余按 `roleId` 读取角色权限（内存缓存 30 秒，保存角色时主动失效）；缺权限返回 403「缺少权限：订单发货」。
- 148 处旧 `@Roles` 已按模块全部替换为 `@Permission`，不再保留角色枚举兜底。
- 新增 `GET /admin/auth/me`，后台刷新页面时拉取最新角色与权限。

**前端**

- `AdminSession` 增加 `permissions: string[]`、`isSuper`；`hasRole` 保留兼容，新增 `can('order.ship')`。
- 菜单项由 `roles: [...]` 改为 `permission?: string`，分组内无可见项时整组隐藏。
- 路由包一层 `<RequirePermission>`；无权限直接访问显示 403 页，不白屏。
- 页面按钮用 `can()` 控制显隐/禁用；接口 403 统一 toast。

**生效策略**：保存角色后后端缓存 30 秒内生效；前端刷新或重新登录后拉取 `/admin/auth/me`。紧急变更可提供「立即刷新缓存」按钮（P2）。

---

## 四、后台页面设计

### 4.1 菜单

「账号」→ 子账号 / **角色** / 操作日志。

角色页需要 `role.view`；新建/编辑/删除需要 `role.manage`。

### 4.2 角色列表 `/accounts/roles`

| 列 | 内容 |
| --- | --- |
| 角色名称 | 名称 |
| 描述 | 截断显示 |
| 成员数 | 关联子账号数量 |
| 权限数 | 已选权限项数量 |
| 更新时间 | 最近修改 |
| 操作 | 编辑、删除（有成员时删除按钮禁用并提示） |

支持按名称搜索；顶部「新建角色」。超级管理员账号不出现在角色成员数里。

### 4.3 新建 / 编辑页

独立路由：`/accounts/roles/new`、`/accounts/roles/:id/edit`（参考截图是整页，不做弹窗）。

- 基础信息：角色名称（必填，0/20）、角色描述（必填，0/200）。
- 角色权限：9 个分组卡片，每组标题带全选复选框（支持半选）、右侧「已选 x/y」；权限项 3–4 列复选。
- 底部固定操作条：取消 / 保存；未保存离开时提示。
- 保存校验：至少选择 1 项权限；取消 `role.manage` 时二次确认，提示影响范围。
- 所有角色一视同仁，没有内置/只读状态；超级管理员不在角色页维护。

### 4.4 子账号页改造

- 角色下拉改为 `/admin/roles` 数据，显示名称；不预置任何角色。
- 门店账号不在角色下拉中，仍通过「账号类型 = 门店」创建并绑定门店。
- 角色变更仍走现有校验：最后一个启用中的超级管理员保护、门店绑定校验。

### 4.5 无权限体验

- 菜单不显示；直接访问路由显示 403 页面（带返回工作台）。
- 页面内无权限的按钮隐藏；保留只读内容。
- 后端 403 文案统一为「缺少权限：xxx」，便于排查。

---

## 五、接口与契约

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /admin/roles` | `role.view` | 列表（含成员数、权限数） |
| `GET /admin/roles/:id` | `role.view` | 详情 |
| `POST /admin/roles` | `role.manage` | 新建，校验名称唯一、权限 key 合法 |
| `PATCH /admin/roles/:id` | `role.manage` | 编辑名称/描述/权限 |
| `DELETE /admin/roles/:id` | `role.manage` | 有成员时 409「该角色下还有 N 个账号」 |
| `GET /admin/permissions` | `role.view` | 返回分组权限目录（也可直接由 shared 打包到前端） |
| `GET /admin/auth/me` | 登录态 | 返回最新角色与权限 |

- 子账号接口 `POST/PATCH /admin/accounts` 的 `role` 枚举改为 `roleId`；响应增加 `roleName`；`kind=STORE` 不传角色。
- 校验：权限 key 必须在目录内；角色至少 1 项权限；角色名唯一。
- 契约：更新 `openapi.yaml` → `pnpm codegen:api`；新增契约测试。

---

## 六、数据迁移

1. 新增 `AdminRoleDef`、`AdminUserKind`，`AdminUser` 增加 `kind/isSuper/roleId`（可空）。
2. 账号类型回填：原 `role = STORE` → `kind = STORE`；其余 → `kind = PC`。
3. 超级管理员回填：原 `role = SUPER` → `isSuper = true`，不绑定角色。
4. 普通账号回填：按原 `OPS/CS/WMS` 创建普通角色「商品运营 / 客服 / 仓储」，权限集合由现有 `@Roles` 映射生成，再绑定 `roleId`。
5. 双轨期：新老守卫并存，按模块迁移 `@Permission`。
6. 收尾：删除 `AdminUser.role` 枚举；`AdminAuthService` 用 `kind = STORE` 拒绝 PC 登录。
7. 回滚：保留 `role` 枚举列一个版本；角色表为新增表，回滚不影响登录。

---

## 七、实施顺序

1. `packages/shared` 权限目录 + Prisma 角色/账号字段 + 迁移回填。
2. 登录返回权限、`PermissionGuard`、`@Permission` 装饰器、`/admin/auth/me`；老接口继续走 `@Roles`。
3. 角色列表页 + 新建/编辑页（权限分组复选）+ 子账号角色下拉改造。
4. 菜单/路由/按钮按权限改造（Layout、App、各页 `hasRole` 替换为 `can`）。
5. 按模块把 `@Roles` 迁移为 `@Permission`，每迁一个模块跑一次契约与 E2E 角色矩阵。
6. 删除 `AdminUser.role` 枚举依赖，补文档与操作日志。

---

## 八、验收标准

| 项 | 标准 |
| --- | --- |
| 存量账号回归 | 迁移后原有账号的可见菜单与可执行操作不变；门店账号仍不能登录 PC |
| 自定义角色 | 新建「客服主管」仅勾选订单查看 + 售后审核 + 客户查看；该角色账号登录后只看到对应菜单 |
| 接口鉴权 | 越权调用返回 403 且文案包含缺失权限；前端直接访问无权限路由显示 403 |
| 角色生命周期 | 被账号使用的角色不可删除；角色名唯一；删除前提示成员数 |
| 超级管理员 | 至少保留一个启用中的超级管理员；`.isSuper` 账号不受角色权限限制 |
| 权限变更 | 保存后 30 秒内接口生效，前端刷新后菜单同步 |
| 审计 | 角色新增/修改/删除出现在操作日志，包含变更前后权限 |
| 工程 | `pnpm verify` 全绿；新增契约测试与角色权限 E2E；`openapi.yaml` 与 api-types 同步 |

---

## 九、风险与备选

| 风险 | 应对 |
| --- | --- |
| 148 个 `@Roles` 迁移量大、易漏 | 老守卫兜底 + 按模块迁移 + 每个存量角色跑一遍接口矩阵测试 |
| 前后端权限两套规则漂移 | 权限目录放 shared，菜单与装饰器都引用同一 key；lint 校验未知 key |
| 权限变更不即时 | 30 秒缓存 + `/admin/auth/me`；提供手动刷新缓存入口 |
| 角色误删/误配导致锁死 | 被占用不可删；取消 `role.manage` 二次确认；至少一个启用超管兜底；权限变更写审计 |
| 全部自定义后初始无角色 | 迁移自动生成 3 个存量角色；新建账号必须选角色；超管可随时创建角色 |

**备选方案**

- A（不推荐）：只做角色表 + 菜单级权限，接口继续 `@Roles`。页面能配置，但无法真正限制操作，存在越权风险。
- B（不推荐）：不建角色，按子账号单独勾权限。账号多时维护成本高，也无法复用。
- **推荐：角色 + 权限目录 + 操作级鉴权 + 渐进迁移**（本提案）。

---

## 十、不做（本次）

- 数据范围权限（按门店/区域过滤数据）；门店账号仍按 `AdminStore` 绑定。
- 字段级权限、按钮内字段脱敏。
- 审批流、临时授权、权限申请。
- 小程序端按角色显示不同底部导航。
- 第三方 SSO / 组织架构同步。
