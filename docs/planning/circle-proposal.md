# 圈子（品牌内容社区）提案

> 需求：平台可配置内容类目与话题；用户可像发朋友圈一样发布图文内容；形成品牌的社交圈子与内容氛围。
> 定位：不是熟人朋友圈，而是「品牌 + 兴趣」的公开内容广场：用户晒单、晒用法、分享山野生活方式，内容可关联商品，最终服务于复购与品牌认同。

**已确认决策**

1. 类目与话题均由平台后台创建，用户只能选择，不能自建话题。
2. 帖子必须归属 1 个类目，可选 0~3 个话题；话题用于运营活动与内容聚合。
3. 首期只做**图文**（1~9 图），不做视频、长文、直播。
4. 帖子可关联 0~3 个商品，展示商品卡并跳转商详，不做带货佣金。
5. 互动首期做**点赞、评论（含回复）、收藏、关注作者、举报**，不做私信与群组。
6. 审核采用「机审 + 先发后审」：文本同步机审、图片异步机审，命中风险自动隐藏待人工；后台可切换「先审后发」。
7. 发帖奖励积分：审核通过 +10 分，每人每日最多 1 次；点赞、评论不奖励，避免刷互动。
8. 入口：小程序「我的」页 + 微页面/底部导航可配置链接；暂不占用底部 Tab，验证后再评估升级为第 5 个 Tab。

---

## 一、目标与价值

| 维度 | 说明 |
| --- | --- |
| 用户价值 | 分享使用场景与心得，获得认同与积分；从「买完即走」变成「逛内容、被种草」 |
| 平台价值 | 沉淀真实 UGC 内容资产，提升停留、复购与商品转化；形成品牌社区氛围 |
| 运营价值 | 通过类目与话题策划活动（如「秋日第一杯茶」），可配置置顶、精选与奖励 |
| 北极星指标 | 圈子周活跃用户数（浏览 + 发帖 + 互动去重） |

**与朋友圈的差异**：朋友圈基于熟人关系链、默认仅好友可见；圈子基于品牌与兴趣、内容公开可见，采用「推荐 / 最新 / 关注」三路信息流。

---

## 二、整体结构

```
小程序
├─ 圈子首页 /pages/circle/index
│  ├─ 类目 Tab（山野食谱 / 茶与咖啡 / 器物日常 / 露营户外 / 买家秀）
│  ├─ 话题横滑（运营话题，含置顶）
│  └─ 信息流：推荐 / 最新 / 关注（双列瀑布流）
├─ 话题页 /pages/circle-topic/index?id=
├─ 帖子详情 /pages/circle-post/index?id=
├─ 发布页 /pages/circle-publish/index
├─ 用户主页 /pages/circle-user/index?id=
├─ 我的圈子 /pages/circle-me/index（我的帖子 / 收藏 / 点赞）
└─ 互动消息 /pages/circle-notifications/index

后台（新增一级分组「圈子」）
├─ 内容审核（待审 / 已发布 / 已拒绝 / 已隐藏 / 举报）
├─ 类目与话题
└─ 圈子设置（开关、审核模式、发帖频率、排序权重）
```

用户主路径：进入圈子 → 浏览/搜索内容 → 点进帖子 → 点赞/评论/收藏 → 点商品卡进商详 → 发布自己的内容 → 审核通过后获得积分与曝光。

---

## 三、方案选择

### 方案 A（推荐）：复用现有账号、素材、积分、商品与权限体系

- 内容数据独立建表，但账号复用 `User`，图片复用素材库，商品卡复用 `Product`，积分复用 `PointsLedger`，后台复用 RBAC 与 DataTable。
- 优点：改动集中在圈子模块，和商城、会员、营销天然打通；缺点：需要新增会员端图片上传与内容安全能力。

### 方案 B：接入第三方社区/SaaS

- 优点：上线快；缺点：账号与商品割裂、数据不在自有库、样式不可控、难以和积分/会员打通。

**结论**：采用方案 A。圈子是独立业务模块，但只复用基础设施，不复制账号与商品体系。

---

## 四、数据模型

```prisma
enum CirclePostStatus {
  PENDING    // 待审核（命中风险或先审后发）
  PUBLISHED
  REJECTED   // 审核拒绝
  HIDDEN     // 违规/作者删除后隐藏
}

enum CircleReportStatus {
  PENDING
  RESOLVED   // 已处理（下架/删除）
  REJECTED   // 驳回举报
}

model CircleCategory {
  id        String   @id @default(cuid())
  name      String
  iconKey   String?
  sort      Int      @default(0)
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  posts     CirclePost[]
}

model CircleTopic {
  id          String    @id @default(cuid())
  name        String
  description String?
  coverKey    String?
  categoryId  String?
  startAt     DateTime?
  endAt       DateTime?
  pinned      Boolean   @default(false)
  enabled     Boolean   @default(true)
  sort        Int       @default(0)
  postCount   Int       @default(0)   // 冗余计数，审核通过 +1
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
}

model CirclePost {
  id            String           @id @default(cuid())
  userId        String
  categoryId    String
  content       String           @db.Text
  /// [{ key, width, height }]，1~9 张
  mediaJson     Json
  status        CirclePostStatus @default(PUBLISHED)
  auditNote     String?
  auditedBy     String?
  auditedAt     DateTime?
  pinned        Boolean          @default(false)
  featured      Boolean          @default(false)
  likeCount     Int              @default(0)
  commentCount  Int              @default(0)
  favoriteCount Int              @default(0)
  viewCount     Int              @default(0)
  publishedAt   DateTime?
  createdAt     DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime         @updatedAt @db.Timestamptz(3)

  user     User                @relation(fields: [userId], references: [id])
  category CircleCategory      @relation(fields: [categoryId], references: [id])
  topics   CirclePostTopic[]
  products CirclePostProduct[]

  @@index([status, publishedAt])
  @@index([categoryId, status, publishedAt])
  @@index([userId, createdAt])
}

model CirclePostTopic {
  postId  String
  topicId String
  sort    Int    @default(0)
  @@id([postId, topicId])
}

model CirclePostProduct {
  postId    String
  productId String
  sort      Int    @default(0)
  @@id([postId, productId])
}

model CircleComment {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  parentId  String?  // 一级回复
  content   String   @db.Text
  hidden    Boolean  @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([postId, createdAt])
}

model CircleLike {
  postId    String
  userId    String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@id([postId, userId])
}

model CircleFavorite {
  postId    String
  userId    String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@id([postId, userId])
}

model CircleFollow {
  followerId  String
  followingId String
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  @@id([followerId, followingId])
}

model CircleReport {
  id         String             @id @default(cuid())
  targetType String             // POST | COMMENT | USER
  targetId   String
  reporterId String
  reason     String             // 广告引流 | 违法违规 | 色情低俗 | 人身攻击 | 虚假信息 | 其他
  detail     String?
  status     CircleReportStatus @default(PENDING)
  handledBy  String?
  handledAt  DateTime?
  createdAt  DateTime           @default(now()) @db.Timestamptz(3)
  @@index([status, createdAt])
}

model CircleNotification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // LIKE | COMMENT | REPLY | FOLLOW | SYSTEM
  actorId   String?
  postId    String?
  commentId String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([userId, read, createdAt])
}
```

积分流水沿用 `PointsLedger.source = 'CIRCLE_POST'`，备注写入帖子 ID；不新增积分表。

---

## 五、后台设计

### 5.1 菜单与权限

新增一级分组「圈子」：内容审核、类目与话题、圈子设置。

| 权限 | 说明 |
| --- | --- |
| `circle.view` | 圈子内容与数据查看 |
| `circle.audit` | 审核 / 拒绝 / 隐藏 / 处理举报 |
| `circle.manage` | 类目、话题与圈子设置 |

写权限自动依赖 `circle.view`；迁移时为运营角色补默认权限。

### 5.2 圈子设置

- 圈子开关（关闭后小程序入口隐藏，后台数据保留）。
- 审核模式：机审后发布（默认）/ 先审后发。
- 发帖频率：每人每日发帖上限（默认 5），评论上限（默认 30）。
- 发帖奖励：积分数量与每日上限（默认 10 分 / 1 次）。
- 信息流权重：点赞、评论、浏览、时间衰减系数。

### 5.3 类目与话题

- 类目：名称、图标、排序、启用；删除前校验是否仍有帖子（有则只能停用）。
- 话题：名称、封面、简介、所属类目（可选）、起止时间、置顶、启用；列表展示帖子数。
- 话题支持「结束」状态：结束后不再出现在发布页可选列表，但历史内容仍可浏览。

### 5.4 内容审核

- 状态页签：待审核、已发布、已拒绝、已隐藏、举报待处理。
- 列表字段：内容摘要、图片缩略图、作者、类目、话题、发布时间、点赞/评论数、风险标签。
- 操作：通过、拒绝（必填原因）、隐藏、置顶、精选；支持批量通过/拒绝。
- 拒绝原因展示在作者「我的圈子」中，支持修改后重新提交。

### 5.5 评论与举报

- 评论列表支持按帖子、作者、关键词筛选；可隐藏单条评论。
- 举报列表展示举报原因、次数、目标内容；处理动作：下架内容、删除评论、驳回举报、封禁作者发言（预留）。
- 同一内容被举报 ≥3 次自动隐藏并进入待审。

### 5.6 数据看板

- 内容供给：日发帖数、发帖用户数、审核通过率、平均审核时长。
- 内容消费：曝光、浏览、互动率、人均停留（埋点统计）。
- 转化：帖子商品卡点击、加购、下单归因。

---

## 六、小程序设计

### 6.1 圈子首页

- 顶部：圈子标题 + 搜索入口 + 「发布」按钮。
- 类目 Tab：横向滚动，默认「推荐」。
- 话题横滑：封面 + 话题名 + 参与数，置顶话题优先。
- 信息流：双列瀑布流；图文帖子按首图比例展示，纯文字帖子用文字卡；显示作者、点赞数、话题标签。
- 排序：推荐（置顶/精选 + 热度衰减）、最新、关注。

### 6.2 帖子详情

- 图片轮播（1~9 张，点击全屏预览）。
- 作者信息 + 关注按钮；正文；话题标签；关联商品卡（最多 3 个）。
- 底部操作：点赞、评论、收藏、分享（分享到微信聊天/朋友圈）、举报。
- 评论区：一级评论 + 回复；作者可删除自己的评论；楼主可删除自己帖子下的评论（可选，P1）。

### 6.3 发布页

- 图片：1~9 张，支持相册/拍照，上传前压缩；复用素材上传接口并新增会员端上传端点。
- 正文：最多 1000 字，实时敏感词提示。
- 类目：必选；话题：最多 3 个，展示进行中的话题。
- 关联商品：最多 3 个，通过商品搜索选择。
- 提交后：机审通过直接发布并提示「已发布」；命中风险提示「已提交审核」。

### 6.4 话题页

- 话题封面、简介、参与人数、活动时间。
- 帖子流（最新/最热），顶部「参与话题」按钮，发布时自动带入该话题。

### 6.5 我的圈子与消息

- 我的圈子：我的帖子（含审核状态与拒绝原因）、收藏、点赞。
- 互动消息：点赞、评论、回复、关注、系统通知；未读红点；点击跳转对应帖子。
- 首期只做站内消息；订阅消息（评论/审核结果）放到 P1。

### 6.6 入口

- 「我的」页新增「我的圈子」入口。
- 微页面装修与底部导航新增链接类型 `circle`，内置页面 `/pages/circle/index`（与积分商城的实现方式一致）。
- 首页运营位可由运营配置跳转圈子或话题。

---

## 七、接口设计

### 7.1 会员/公开接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/circle/categories` | 启用类目 |
| GET | `/circle/topics?categoryId=` | 话题列表（含置顶） |
| GET | `/circle/posts?tab=&categoryId=&topicId=&cursor=` | 信息流，游标分页 |
| GET | `/circle/posts/:id` | 帖子详情（登录用户返回是否点赞/收藏/关注） |
| POST | `/circle/posts` | 发布（限频、机审、积分） |
| DELETE | `/circle/posts/:id` | 作者删除 |
| POST/DELETE | `/circle/posts/:id/like` | 点赞 / 取消 |
| POST/DELETE | `/circle/posts/:id/favorite` | 收藏 / 取消 |
| GET | `/circle/posts/:id/comments` | 评论列表（分页） |
| POST | `/circle/comments` | 发表评论/回复 |
| DELETE | `/circle/comments/:id` | 删除自己的评论 |
| POST | `/circle/reports` | 举报 |
| GET | `/circle/users/:id` | 用户主页 |
| POST/DELETE | `/circle/users/:id/follow` | 关注 / 取关 |
| GET | `/circle/me/posts` / `favorites` / `likes` | 我的内容 |
| GET | `/circle/notifications` | 互动消息 |
| POST | `/circle/notifications/read` | 标记已读 |

### 7.2 后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST/PATCH | `/admin/circle/categories` | 类目 |
| GET/POST/PATCH | `/admin/circle/topics` | 话题 |
| GET | `/admin/circle/posts?status=` | 内容列表 |
| PATCH | `/admin/circle/posts/:id/audit` | 通过 / 拒绝 / 隐藏 |
| PATCH | `/admin/circle/posts/:id/flags` | 置顶 / 精选 |
| GET/PATCH | `/admin/circle/comments/:id` | 评论隐藏 |
| GET/PATCH | `/admin/circle/reports/:id` | 举报处理 |
| GET/PATCH | `/admin/circle/settings` | 圈子设置 |
| GET | `/admin/circle/stats` | 数据看板 |

### 7.3 关键规则

- 发帖：校验类目/话题有效性、图片数量与大小、每日上限；命中敏感词直接待审；否则机审后发布并发放积分。
- 点赞/收藏：幂等，重复请求不重复计数；计数使用原子自增。
- 评论：校验帖子状态与频率；被隐藏帖子不可评论。
- 信息流：只返回 `PUBLISHED`；游标用 `publishedAt + id`，避免深分页。
- 举报：同一用户对同一目标只能举报一次；累计 3 次自动隐藏待审。

---

## 八、内容安全与审核

1. **文本**：发布时同步调用微信 `msgSecCheck`，同时过本地敏感词库；命中即进入待审。
2. **图片**：调用 `mediaCheckAsync` 异步检测，结果回调后命中则自动隐藏并通知运营。
3. **人工**：后台审核队列；拒绝需填写原因，作者可见并可修改重提。
4. **举报**：帖子、评论、用户均可举报；3 次自动隐藏待审，运营处理留痕。
5. **合规**：更新《用户协议》《隐私政策》，说明 UGC 发布规范、审核与举报机制；保留内容与审核日志不少于 6 个月。

---

## 九、激励与运营

- **发帖积分**：审核通过 +10 分，每日上限 1 次，写入 `PointsLedger`（来源「圈子发帖」）。
- **精选奖励**：运营在后台将帖子设为精选，可手动发放积分（复用现有调积分能力）。
- **话题活动**：话题可配置封面与时间，配合首页横滑与微页面运营位；活动奖励 P1 再做自动发放。
- **冷启动**：上线前由运营准备 30~50 条种子内容（员工/达人），覆盖全部类目与 3 个话题。
- **内容分发**：精选与置顶加权；热度公式 `点赞×2 + 评论×3 + 浏览×0.1`，按发布时间衰减。

---

## 十、实施顺序

1. **数据与配置**：Prisma 模型与迁移、权限目录、后台菜单、类目/话题/设置接口与页面。
2. **发布链路**：会员端图片上传、发帖接口、敏感词与微信内容安全、积分发放、审核队列。
3. **消费链路**：圈子首页信息流、帖子详情、点赞/收藏/评论、用户主页。
4. **治理与通知**：举报、评论管理、互动消息、未读红点。
5. **运营与入口**：微页面/底部导航 `circle` 链接、我的入口、数据看板。
6. **测试**：契约测试（发布/审核/点赞/举报/权限）、E2E（发布→审核→点赞评论→举报处理）、`pnpm verify`。

---

## 十一、验收标准

| 项 | 标准 |
| --- | --- |
| 平台配置 | 后台可增删改类目与话题；停用类目不再出现在发布页；结束话题不可再选 |
| 发布 | 1~9 图 + 正文可发布；类目必选；话题最多 3 个；商品最多 3 个 |
| 审核 | 命中敏感词进入待审；后台可通过/拒绝/隐藏；拒绝原因作者可见 |
| 信息流 | 推荐/最新/关注三路可切换；仅展示已发布内容；游标分页无重复 |
| 互动 | 点赞、收藏幂等；评论与回复正常；计数与列表一致 |
| 消息 | 点赞/评论/关注产生站内消息与未读红点 |
| 举报 | 同一目标重复举报拦截；累计 3 次自动隐藏待审；后台处理留痕 |
| 激励 | 审核通过发放积分且每日仅一次；流水来源正确 |
| 入口 | 我的页、微页面、底部导航均可进入圈子 |
| 工程 | `pnpm verify` 全绿；权限矩阵与契约/E2E 覆盖 |

---

## 十二、不做（P1）

- 视频、长文、直播、语音。
- 用户自建话题、话题投票、话题排行榜。
- 私信、群组、@提及、地理位置。
- 草稿箱、定时发布、内容置顶购买。
- 算法个性化推荐（先用时间 + 热度）。
- 带货佣金、内容付费、商品挂车分佣。
- 评论点赞、二级以上楼中楼、表情包。

---

## 十三、指标与埋点

| 类别 | 指标 |
| --- | --- |
| 供给 | 日发帖数、发帖用户数、审核通过率、平均审核时长 |
| 消费 | 圈子 DAU、人均浏览帖子数、帖子曝光点击率、互动率 |
| 关系 | 关注数、回访率、作者留存 |
| 转化 | 商品卡点击率、加购率、内容归因订单 |
| 治理 | 举报率、违规下架率、拒绝率 |

埋点：进入圈子、切换类目/话题、曝光、点击帖子、点赞、评论、收藏、点商品卡、发布成功、举报。

---

## 十四、风险与应对

| 风险 | 应对 |
| --- | --- |
| 冷启动内容少 | 上线前种子内容 + 话题活动 + 精选位；首页优先展示运营内容 |
| 内容安全合规 | 微信内容安全 + 敏感词 + 人工审核 + 举报；默认先发后审但风险自动隐藏 |
| 审核成本高 | 机审前置、批量操作、举报优先；后续按通过率调整策略 |
| 刷积分/刷互动 | 每日发帖上限、仅审核通过发放、点赞幂等、频率限制 |
| 性能与存储 | 游标分页、计数冗余、图片压缩与素材库复用 |
| 与商城割裂 | 商品卡与商详打通，帖子支持按商品反查（P1） |
