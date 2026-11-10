# 微页面可视化装修 + 底部导航自定义 提案

> 范围：把现有「首页运营位」升级为「页面装修」：① 底部导航自定义配置；② 多微页面的可视化搭建（公告 / 搜索框 / 轮播图 / 图片热区 / 商品 / 辅助线 / 视频 / 文本 / 图文导航），支持页面级设置（名称、分享图等）。
> 参照：所附三张截图（微页面列表、三栏编辑器、底部导航配置）。
> 原则：先做到「能配、能发、能回滚」，暂不做自由画布/绝对定位；旧首页数据自动迁移，老版本小程序不受影响。

---

## 一、现状与问题

| 维度 | 现状 | 问题 |
| --- | --- | --- |
| 首页内容 | `HomeBanner` + `HomeNav` + `HomeSection` 三张表，后台一个表单页全量覆盖保存 | 只能配「轮播 / 金刚区 / 推荐位」三段固定结构，不能自由编排 |
| 页面数量 | 只有首页一种 | 无法做活动页、专题页、品牌页 |
| 底部导航 | 写死在 `apps/miniapp/src/app.config.ts` 的 `tabBar` | 改文案/图标/顺序要发版，运营无法自助 |
| 发布 | 保存即生效，无草稿/预览/回滚 | 运营改错会直接影响线上 |
| 链接 | 每处各写一套 `linkType/linkValue`，仅 product/category/search/page | 组件越多越难维护，缺微页面、优惠券、秒杀等目标 |
| 分享 | 无页面级分享设置 | 分享卡片标题/图固定，活动页传播效果差 |

---

## 二、目标与范围

### 2.1 本期目标（P1）

1. **微页面 CRUD**：列表（关键字/时间/状态筛选）、新建、复制、编辑、删除、设为首页、推广。
2. **可视化编辑器**：左侧组件库、中间手机预览画布、右侧属性面板；组件上下移动、复制、删除、显隐；改动实时预览。
3. **8 个基础组件 + 图文导航**：公告、搜索框、轮播图、图片热区、商品组件、辅助线、视频、文本，以及承接金刚区的图文导航；每个组件有类型专属属性 + 通用样式（外边距/内边距/背景/圆角）。
4. **草稿 / 发布分离**：自动保存草稿；「上线」生成发布快照；线上只读发布快照；支持「回滚到上一版」。
5. **页面设置**：页面名称、分享标题/描述/分享图（5:4）、页面背景色、导航栏标题与颜色、是否允许分享。
6. **底部导航配置**：2~5 个入口，名称/图标/选中图标/跳转目标，导航背景色、文字色、选中色；保存后小程序动态生效。
7. **统一链接体系**：微页面 / 商品 / 分类 / 搜索词 / 秒杀活动 / 优惠券 / 门店 / 购物车 / 我的 / 订单 / 内置页面 / 不跳转。
8. **数据迁移**：把现有首页轮播、金刚区、推荐位、秒杀、精选自动生成一个 `home` 微页面，视觉与现在一致。

### 2.2 明确不做（本期）

- 自由布局（拖到任意坐标的「魔方/自由布局」）。
- 富文本 HTML 编辑器（避免跨端渲染差异与 XSS，文本组件用纯文本 + 样式）。
- 定时发布、A/B 测试、组件曝光/点击埋点（P2）。
- 视频转码/压缩与时长裁剪（P1 素材库直传原文件，仅做格式与大小校验）。
- 商品分类页、用户中心首页装修（P3，截图里有，但依赖商品/会员模块的页面结构）。

---

## 三、关键决策

| # | 决策点 | 方案 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| D1 | 首页是否也变成微页面 | 系统内置 `home` 页（`isHome=true`，不可删除，可编辑），运营可在编辑器内整体改写首页 | 已确认 | 只有一套渲染/发布/回滚逻辑；迁移脚本生成初始内容并直接发布。备选：首页继续走旧表（已否决） |
| D2 | 底部导航实现 | **前端自绘 TabBar 组件**（配置由后端下发），不再用原生 `tabBar`；切页统一用 `reLaunch` | 已确认 | 原生 tabBar 数量与链接在编译期固定，无法 2~5 动态变化；自绘可完全由后台控制。代价：无原生切换动画，需本地缓存避免闪烁 |
| D3 | 组件存储 | **JSON 文档**（`components Json`），服务端按组件白名单 + 每类型 Schema 校验 | 已采用 | 组件属性差异大，一组件一张表会爆炸；JSON + 强校验可控。加 `schemaVersion` 便于后续演进 |
| D4 | 发布模型 | 草稿字段 + 发布快照字段（双快照），发布时复制并 `version+1` | 已采用 | 简单、支持回滚上一版；P2 若需完整版本历史再拆 `MicroPageRelease` 表 |
| D5 | 金刚区如何承接 | **P1 增加「图文导航」组件**（同框架，成本低），迁移时把现有 `HomeNav` 映射过去 | 已确认 | 8 个组件里没有金刚区；用图片热区硬拼体验差、不可复用 |
| D6 | 视频组件素材 | **P1 走素材库直传**（mp4/mov/webm，≤50MB，封面必填）；外链 URL 放 P2 | 已确认 | 不用外链方案。需扩展素材库白名单与大小限制；转码/压缩放 P2 |
| D7 | 入口命名与路由 | 菜单名改为「**页面装修**」，路由先保留 `/settings/home` | 已确认 | 改名符合新能力；保留路由避免外链与 E2E 回归，P2 再迁 `/decoration/pages` |

---

## 四、后台信息架构与界面设计

### 4.1 页面结构

```
装修 → 页面装修（原「首页运营位」）
├─ 微页面            ← 默认 tab，列表
│   └─ 编辑页         ← 三栏编辑器（独立路由 /settings/home/:id）
├─ 底部导航          ← 配置页
└─ 页面设置          ← 编辑器内右侧抽屉/弹窗，不单独成页
```

列表页操作：`新建微页面`、关键字 / 创建时间 / 状态筛选、草稿箱切换；每行操作：`复制 / 编辑 / 推广 / 设为首页 / 删除`。
删除保护：被底部导航、其他页面链接、当前首页引用的页面禁止删除，并提示引用位置。

### 4.2 编辑器布局（对齐截图）

```
┌──────────────────────────────────────────────────────────────┐
│ 微页面 / EVOLIA直营店            [页面设置] [组件管理]   [×] │
├───────────┬───────────────────────────────┬──────────────────┤
│ 组件库     │        手机预览（375px）        │  属性面板         │
│           │  ┌─────────────────────────┐  │  组件属性         │
│ 基础组件   │  │  公告                   │  │  ─────────        │
│  公告      │  ├─────────────────────────┤  │  通用样式         │
│  搜索框    │  │  搜索框                 │  │   外边距/内边距   │
│  轮播图    │  ├─────────────────────────┤  │   背景/圆角       │
│  图片热区  │  │  轮播图                 │  │                  │
│  商品      │  ├─────────────────────────┤  │                  │
│  文本      │  │  商品（网格）           │  │                  │
│ 布局组件   │  └─────────────────────────┘  │                  │
│  辅助线    │                               │                  │
│  视频      │  点击组件选中，hover 出工具条  │                  │
├───────────┴───────────────────────────────┴──────────────────┤
│                    [上线]  [保存并继续]  [保存为草稿]          │
└──────────────────────────────────────────────────────────────┘
```

交互要点：

- 点击左侧组件 → 追加到画布末尾并选中。
- 画布内点击选中；hover 工具条：上移 / 下移 / 复制 / 隐藏 / 删除；拖拽手柄调整顺序（HTML5 drag，不引入新依赖）。
- 右侧属性改动即时反映到画布；输入类字段 300ms 防抖。
- 草稿自动保存：改动后 800ms 防抖 `PUT`，顶部显示「保存中 / 已保存 / 保存失败重试」。
- 有未保存改动时离开页面二次确认。
- 「上线」前跑前端校验（必填、图片已选、链接已选），失败定位到具体组件并高亮。
- 发布中禁用按钮，成功后 toast「已上线，预计 1 分钟内生效」。
- 撤销/重做（Ctrl/Cmd+Z、Shift+Ctrl/Cmd+Z）作为编辑器基础能力，限制最近 20 步。

### 4.3 组件属性清单

所有组件共享：`visible`、`margin {top,right,bottom,left}`、`padding {top,right,bottom,left}`、`bgColor`、`radius`。

| 组件 | 核心属性 |
| --- | --- |
| **公告** | 文案（≤100 字）、前置标签（如「包邮」）、滚动/固定、滚动速度、文字色/背景色、图标、点击链接 |
| **搜索框** | 占位文案、形状（胶囊/圆角/直角）、背景色/文字色、是否显示热词、热词（≤6 个，逗号分隔）、点击目标（默认搜索页，可带关键词） |
| **轮播图** | 图片列表（1~10 张，每张可配链接）、高度比（16:9 / 4:3 / 3:2 / 2:1 / 自定义 px）、自动播放、间隔（2~10s）、指示器（点/无）、圆角 |
| **图片热区** | 主图、热区列表（≤20 个，百分比坐标 x/y/w/h + 链接）、替代文案、圆角 |
| **商品** | 数据来源：手动选择 / 按分类 / 秒杀活动 / 精选兜底；手动选品 ≤50；分类；数量上限；列表样式（一行两个 / 一行三个 / 一大两小 / 详细列表 / 横向滑动）；显示字段（名称/价格/划线价/销量/角标）；购买按钮；卡片背景、圆角、页边距、商品间距 |
| **辅助线** | 线型（实线/虚线/点线）、颜色、粗细（1~8px）、上下间距 |
| **视频** | 从素材库选择视频（mp4/mov/webm，≤50MB）、封面图（必填）、宽高比（16:9 / 1:1 / 4:3）、自动播放、循环、静音、圆角 |
| **文本** | 文案（≤500 字，支持换行）、字号（12~32）、颜色、字重、对齐、行高、最大行数、背景、内边距、点击链接 |
| **图文导航**（金刚区） | 每行数量（4/5）、入口列表（图标、名称、链接）、图标形状（圆形/方形）、文字大小/颜色 |

### 4.4 底部导航配置页

- 导航项 2~5 个（少于 2 或多于 5 保存时报错）。
- 每项：名称（≤5 字）、图标、选中图标、链接；内置「首页」项建议置顶且必选，位置可调。
- 全局：背景色、文字色、选中色、是否显示顶部细线。
- 右侧实时手机预览（含安全区）。
- 保存后写入 `ShopTabbar`，小程序下次启动或前台恢复时拉取（本地缓存 5 分钟 + `updatedAt` 校验）。

---

## 五、数据模型

```prisma
/// 微页面：草稿字段与发布快照分离，线上只读快照
model MicroPage {
  id                  String    @id @default(cuid())
  /// 访问标识，如 home / new-arrivals；小程序路径 /pages/micro/index?code=xxx
  code                String    @unique
  title               String
  /// DRAFT | PUBLISHED
  status              String    @default("DRAFT")
  isHome              Boolean   @default(false)
  /// 组件文档（草稿）
  components          Json      @default("[]")
  /// 已发布组件快照
  publishedComponents Json?
  /// 页面设置（草稿）：title/shareTitle/shareDesc/shareImageKey/bgColor/navStyle/allowShare
  settings            Json      @default("{}")
  publishedSettings   Json?
  schemaVersion       Int       @default(1)
  version             Int       @default(0)
  publishedAt         DateTime?
  publishedBy         String?
  updatedBy           String?
  deletedAt           DateTime?
  createdAt           DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime  @updatedAt @db.Timestamptz(3)

  @@index([status, isHome])
  @@index([deletedAt])
}

/// 底部导航（单例）
model ShopTabbar {
  id        String   @id @default("singleton")
  enabled   Boolean  @default(true)
  /// { background, color, selectedColor, borderTop }
  style     Json     @default("{}")
  /// [{ key, text, iconKey, activeIconKey, link }]
  items     Json     @default("[]")
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
}
```

组件文档结构（存 `components`）：

```json
[
  {
    "id": "cmp_1",
    "type": "banner",
    "visible": true,
    "style": { "margin": [0, 0, 8, 0], "padding": [0, 0, 0, 0], "bgColor": "", "radius": 8 },
    "props": {
      "items": [
        { "imageKey": "/api/media/assets/2026/11/a.jpg", "link": { "type": "product", "value": "cuid" } }
      ],
      "heightRatio": "2:1",
      "autoplay": true,
      "interval": 4,
      "indicator": "dots"
    }
  },
  {
    "id": "cmp_2",
    "type": "goods",
    "visible": true,
    "style": { "margin": [8, 12, 8, 12] },
    "props": {
      "source": "category",
      "categoryId": "cuid",
      "limit": 6,
      "layout": "grid-2",
      "show": { "price": true, "originPrice": true, "sales": false, "tag": true },
      "buyButton": false,
      "cardBg": "#ffffff",
      "radius": 12
    }
  }
]
```

统一链接对象（前后端共用）：

```ts
type MicroLink =
  | { type: 'none' }
  | { type: 'micro'; value: string }        // 微页面 code
  | { type: 'product'; value: string }      // 商品 id
  | { type: 'category'; value: string }
  | { type: 'search'; value: string }
  | { type: 'seckill'; value: string }      // 活动 id
  | { type: 'coupon'; value: string }
  | { type: 'store'; value: string }
  | { type: 'cart' | 'orders' | 'mine' | 'points' | 'coupons' }
  | { type: 'page'; value: string };         // 内置页面路径白名单
```

新增共享包文件 `packages/shared/src/microPage.ts`：组件类型枚举、链接类型与文案、`MICRO_PAGE_LIMITS`（组件数 50、轮播 10、热区 20、文本 500 字等）、固定页面白名单。

---

## 六、接口设计

### 6.1 小程序（公开）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/micro-pages/:code` | 返回已发布快照 `{ code,title,version,settings,components,updatedAt }`；未发布返回 404 |
| GET | `/shop/shell` | `{ tabbar, homeCode, version, updatedAt }`；小程序启动/回前台时拉取，带 ETag |
| GET | `/home` | **保留不动**，老版本小程序兼容；新版本首页改用微页面 |

缓存：`ETag = updatedAt + version`，`Cache-Control: public, max-age=60`；发布后最多 60s 生效。

### 6.2 后台

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/micro-pages` | 列表：keyword / status / dateFrom / dateTo / page |
| POST | `/admin/micro-pages` | 新建 `{ title, code?, copyFromId? }` |
| GET | `/admin/micro-pages/:id` | 详情（草稿 + 发布状态 + 引用信息） |
| PUT | `/admin/micro-pages/:id` | 保存草稿 `{ title, components, settings, expectedUpdatedAt }`；冲突返回 409 |
| POST | `/admin/micro-pages/:id/publish` | 发布快照、version+1、写发布人 |
| POST | `/admin/micro-pages/:id/duplicate` | 复制为新草稿 |
| POST | `/admin/micro-pages/:id/set-home` | 设为首页（事务内互斥，同时清理旧 home 标记） |
| POST | `/admin/micro-pages/:id/rollback` | 回滚到上一版发布快照（P1.5） |
| DELETE | `/admin/micro-pages/:id` | 软删除；被引用时 400 并返回引用位置 |
| GET | `/admin/link-options` | 统一链接选择器数据源：`type` + `keyword` + 分页，返回 `{ items:[{id,label,imageKey}] }` |
| GET/PUT | `/admin/tabbar` | 底部导航读取/保存 |

权限：写操作 `SUPER` / `OPS`；`CS` 只读（沿用首页运营位现状）。所有写操作记 `updatedBy`，可扩展操作日志。

### 6.3 服务端校验（关键）

- 组件白名单：未知 `type` 直接 400；单页 ≤50 个组件。
- 每类型必填校验（如轮播必须有图、商品必须选品/分类、热区坐标 0~100）。
- 图片/封面/视频：复用 `AssetService.assertReference`，必须是素材库已有资源；视频额外校验 mime 白名单（mp4/mov/webm）、文件头与类型一致、≤50MB。
- 素材库上传扩展：现有上传接口与素材库页面增加视频类型（mp4/mov/webm，≤50MB），支持视频预览与类型筛选，素材列表展示时长（前端读取）。
- 链接：按类型校验目标存在且状态合法（商品在售、活动进行中/未开始、微页面已发布），`page` 只允许白名单路径。
- 颜色只接受 `#RGB/#RRGGBB` 或空；数值范围裁剪；文本长度限制。
- 发布前再次全量校验，避免「草稿能存但发布后线上报错」。

---

## 七、小程序端改造

### 7.1 渲染链路

```
pages/home/index         → 读取 home 微页面（发布快照）渲染
pages/micro/index?code=  → 任意微页面渲染
components/micro/*       → 8 + 1 个组件（View/Image/Swiper/Video/ScrollView 实现）
components/TabBar        → 自绘底部导航（4 个主页面 + 微页面共用）
utils/microLink.ts       → 统一跳转解析
```

- 首页保留顶部安全区与导航栏，其余内容全部由组件拼装；迁移脚本生成与原首页一致的首屏。
- 微页面支持下拉刷新（重新拉取快照）。
- 分享：`onShareAppMessage` 使用 `settings.shareTitle/shareDesc/shareImageKey`，路径带 `?code=`；H5 侧同步 `document.title`。
- 骨架屏：本地缓存上次快照，冷启动先渲染缓存再静默更新，避免白屏。
- 兜底：接口失败且无缓存 → 首页展示内置兜底（品牌头图 + 分类 + 精选），微页面展示「页面不存在或已下线」。

### 7.2 自绘 TabBar

| 项 | 方案 |
| --- | --- |
| 数据 | `/shop/shell` → 存 storage，键 `shanye_shell`，含 `updatedAt`，TTL 5 分钟 |
| 展示 | 固定在底部，`padding-bottom: env(safe-area-inset-bottom)`；图标缺省时用内置矢量图标 |
| 切换 | `Taro.reLaunch({ url })`；当前页高亮按 route 匹配 |
| 徽标 | P2：购物车角标（复用购物车数量接口） |
| 回退 | `SHOP_TABBAR_MODE=config` 时可退回原生 4 tab（保留 `app.config.ts` 的 tabBar 与 4 个页面路径，用环境变量切换构建） |

> 注意：自绘后 `pages/home|category|cart|mine` 不再是原生 tab 页，`switchTab` 一律改为 `reLaunch`；分享进入非首页时底部导航仍可正常切换。这是本期最大行为变更，需要回归所有入口跳转。
>
> 落地检查清单（来自去原生 TabBar 的经验）：
> 1. **移除原生 `tabBar` 配置**：`app.config.ts` 中 `tabBar` 改为空或删除，4 个主页面保留但不再是 tab 页；H5 与 weapp 统一自绘。
> 2. **安全区适配**：所有展示 TabBar 的页面容器补齐 `padding-bottom: env(safe-area-inset-bottom)`，避免内容被底栏遮挡。
> 3. **替换 `switchTab`**：全局搜索 `switchTab`，统一替换为 `reLaunch`（主入口）或 `navigateTo`（子页面），禁止残留旧 API 导致点击无效。
> 4. **不把详情页塞进 TabBar**：「某页也要显示底栏」= 在该页复用同一底栏组件，而不是新增一个 tab 项。
> 5. **UI 规范先行**：实现前确认底栏高度、图标资源占位规则（建议沿用素材库图标键，缺省用内置矢量图标）、选中态颜色，避免功能做完后反复返工视觉结构。

### 7.3 链接解析

按 `MicroLink.type` 映射：

| type | 目标 |
| --- | --- |
| micro | `/pages/micro/index?code=`（当前页则忽略） |
| product | `/pages/product/index?id=` |
| category | `/pages/category/index?categoryId=` |
| search | `/pages/search/index?keyword=` |
| seckill | `/pages/product/index?id=<活动首个商品>` 或活动页（按现有促销页实现） |
| coupon | `/pages/coupon/index`（可选带 id 定位） |
| store | `/pages/store/list/index`（可选带 id） |
| cart / orders / mine / points / coupons | 对应页面 |
| page | 白名单内置页面路径 |
| none | 不响应 |

---

## 八、老数据迁移

1. 迁移脚本（一次性 + 可重复执行）读取现有 `HomeBanner` / `HomeNav` / `HomeSection`：
   - banners → 1 个「轮播图」组件；
   - navs → 1 个「图文导航」组件；
   - sections → 每个 1 个「商品」组件（source=manual）；
   - 秒杀 → 1 个「商品」组件（source=seckill）；
   - 原品牌头图 + 搜索 + 包邮提示 → 文本 / 搜索框 / 公告组件。
2. 生成 `code=home`、`isHome=true` 的微页面，**直接发布**，`version=1`。
3. 开关：`ShopConfig` 增加 `homeRenderer: 'legacy' | 'micro'`（默认 `legacy`）。后台可一键切换，出问题立即回退。
4. 旧表保留只读一个迭代，确认无回归后再删除表与旧接口写入逻辑。
5. 新版本小程序首页读微页面；若 `homeRenderer=legacy` 或接口失败，回退旧 `/home` 渲染。

---

## 九、测试与验收

### 9.1 契约测试

- 微页面 CRUD、权限（CS 只读）。
- 草稿不影响线上：保存草稿后 `/micro-pages/:code` 仍返回旧快照；发布后才变化。
- 组件校验：未知 type、超限、图片不存在、链接失效、热区越界。
- 设为首页互斥；删除被引用页面被拒绝；软删除后列表不可见、公开接口 404。
- 底部导航：2~5 项限制、颜色格式、首页项必选。
- 并发保存 409。

### 9.2 单测

- 组件校验器逐类型用例。
- 链接解析器（前后端路径一致性）。
- 迁移函数：给定旧数据生成期望组件 JSON。

### 9.3 E2E

1. 后台新建页面 → 添加公告/轮播/商品 → 保存草稿 → 刷新后内容还在。
2. 上线 → 打开 `/pages/micro/index?code=` 断言组件与文案。
3. 设为首页 → 小程序首页展示新内容；回退设为旧首页。
4. 删除被底部导航引用的页面 → 出现引用提示且删除失败。
5. 修改底部导航文案 → 小程序底部导航即时更新。
6. 未登录用户可正常浏览微页面（`auth: 'optional'`）。

### 9.4 性能与体验验收

- 微页面首屏组件 ≤8 个时，H5 首屏渲染 <1.5s（本地）；图片懒加载。
- 首页冷启动有缓存时不出现白屏；无缓存时骨架屏 ≤300ms 出现。
- 编辑器 50 个组件时拖拽/属性修改无可感知卡顿。

---

## 十、分期

| 阶段 | 内容 |
| --- | --- |
| **P1（本期）** | 数据模型与迁移、微页面列表/编辑/复制/删除/设为首页、8 组件 + 图文导航、页面设置与分享、草稿/发布/回滚上一版、底部导航配置、统一链接、视频素材库直传、小程序渲染 + 自绘 TabBar、灰度开关、契约 + E2E |
| **P1.5** | 组件复制/撤销重做增强、引用检查弹窗、推广弹窗（复制路径）、页面复制、空态与引导、操作日志 |
| **P2** | 小程序码推广（`wxacode.getUnlimited`，复用集成配置）、视频外链 URL 与转码压缩、草稿箱与版本历史、定时发布、组件埋点（曝光/点击）与页面数据、模板库 |
| **P3** | 自由布局/魔方组件、商品分类页与用户中心首页装修、组件级 A/B |

---

## 十一、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 自绘 TabBar 体验退化（无原生切换动画） | 用户感知 | 本地缓存 + 首屏骨架；保留环境变量回退原生 4 tab；真机验证 iOS/Android 安全区 |
| JSON 组件结构后续演进 | 老数据渲染异常 | `schemaVersion` + 服务端读取时迁移；渲染层对未知类型静默跳过 |
| 运营误发布 | 线上首页异常 | 草稿/发布分离、发布前全量校验、上一版回滚、`homeRenderer` 一键回退 |
| 视频文件过大拖慢页面 | 首屏慢、流量高 | 直传限制 50MB 与格式白名单；列表/首屏提示；P2 增加转码压缩与封面兜底 |
| 编辑器复杂度超预期 | 交付延期 | P1 固定纵向流式布局，不做自由画布；组件属性只做高频项，低频项后续加 |
| 老版本小程序未升级 | 首页不可用 | 保留 `/home` 与旧渲染，服务端按 `homeRenderer` 分发；微页面接口独立 |
| 大图拖慢首屏 | 转化下降 | 上传时建议尺寸提示、列表懒加载、首屏组件数量限制提示 |

---

## 十二、决策结论

全部决策已确认，P1 已按本方案实施完成：

- 后台「装修 / 页面装修」：微页面列表、三栏编辑器（9 个组件 + 属性面板 + 手机预览）、页面设置、草稿自动保存、上线 / 回滚 / 复制 / 设为首页 / 删除保护。
- 底部导航：独立配置页，2~5 个入口，小程序自绘 TabBar 读取 `/shop/shell`，页面跳转统一 `reLaunch`。
- 小程序：新增 `pages/micro/index` 渲染器与 9 个组件；首页按 `homeRenderer` 在旧版与微页面之间切换；老首页可一键迁移为 `home` 微页面。
- 素材库：支持视频直传（mp4/mov/webm，≤50MB）与类型筛选，供视频组件使用。
- 落地补充：草稿保存允许组件未填完（发布时严格校验）；`/shop/shell` 每次进入页面后台刷新，运营改完导航无需等缓存过期。

1. **D1 首页纳管**：首页允许运营在微页面编辑器里整体改写；内置 `home` 页，迁移脚本把现有首页内容整体迁入并直接发布。
2. **D6 视频**：不接受外链方案，P1 视频组件直接走素材库直传（mp4/mov/webm，≤50MB，封面必填）；外链 URL 与转码压缩放 P2。
3. **D2 底部导航**：自绘 TabBar + `reLaunch` 切页。
4. **D5 金刚区**：P1 增加「图文导航」组件承接。
5. **D7 命名**：菜单名「页面装修」，路由暂留 `/settings/home`。
