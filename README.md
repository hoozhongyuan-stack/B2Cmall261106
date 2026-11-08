# 山野商城

B2C 商城：微信小程序（AppID `wx04619aa796c2188f`）+ 管理后台 + API。

产品与规则：[PRD](docs/B2C商城-需求调研与产品设计.html) · [技术方案](docs/tech/B2C商城-技术方案.html) · [设计规范](docs/ui/design-system.html) · [工程契约](docs/engineering/工程契约.html)

## 结构

```
apps/api          NestJS + Prisma（端口 3000，Swagger /api/docs）
apps/admin        管理后台（React 18 + Vite，端口 5173）
apps/miniapp      微信小程序（Taro 4 + React，可构建 weapp / H5）
packages/shared   金额计算与状态机（唯一实现，含单测）
packages/tokens   设计 token（颜色/字阶/间距，唯一来源）
packages/api-types openapi.yaml 生成的接口类型（codegen，勿手改）
docs              产品、技术、设计、工程契约文档
docker/compose.yml  本地 PostgreSQL（5433）
```

## 本地启动

```bash
pnpm install
docker compose -f docker/compose.yml up -d      # PostgreSQL 16，端口 5433
cp apps/api/.env.example apps/api/.env
pnpm --filter @shanye/api exec prisma migrate deploy
pnpm --filter @shanye/api db:seed

# 契约测试使用独立库（可选但推荐）：先建库，再在 .env 配 TEST_DATABASE_URL
createdb -h 127.0.0.1 -p 5433 -U postgres shanye_test

pnpm --filter @shanye/api dev                    # API: http://127.0.0.1:3000/api/docs
pnpm --filter @shanye/admin dev                  # 后台: http://127.0.0.1:5173（代理 /api）
pnpm --filter @shanye/miniapp dev:h5             # 小程序 H5 预览
pnpm --filter @shanye/miniapp dev:weapp          # 微信开发者工具导入 apps/miniapp
```

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm lint` | 契约静态检查（裸色值 / 魔法字号 / 手写状态判断 / 跨层 import） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | 单测 |
| `pnpm test:coverage` | 单测 + packages/shared 覆盖率 90% 门槛 |
| `pnpm test:contract` | 契约测试（需 API 可构建 + 数据库可写；配置 `TEST_DATABASE_URL` 时自动重建独立测试库） |
| `pnpm test:e2e` | Playwright 主链路 E2E（自动拉起 API / 后台 / H5，复用本机 Chrome） |
| `pnpm codegen:api` | 由 openapi.yaml 生成 `packages/api-types` |
| `pnpm db:demo-reset` | 重置数据库并重新灌入演示数据（演示/录屏前执行，会清空契约测试留下的订单与评价） |
| `pnpm db:backup` | 逻辑备份到 `backups/`（gzip，保留 7 天，可用 `RETENTION_DAYS` 覆盖） |
| `pnpm deploy:remote` | 构建后台/H5 并部署到联调服务器（`car.aition.art`），含迁移与健康检查 |
| `pnpm build:api` | 构建 API |
| `pnpm build:web` | 构建管理后台与小程序 H5 |
| `pnpm verify` | 本地跑完 CI 全链路 |

## 种子账号

| 账号 | 密码 | 角色 |
|---|---|---|
| admin@shanye.com | admin123 | 超级管理员 |
| ops@shanye.com | ops12345 | 商品运营 |
| cs@shanye.com | cs123456 | 客服 |
| wms@shanye.com | wms12345 | 仓储 |

## 开发流程与门禁

CI（`.github/workflows/ci.yml`）在每次 push 与 PR 上运行 9 个检查：Prepare types → Lint → Typecheck → Unit tests → Prisma migrate → Contract tests → Build API → Build web → TODO guard。

`main` 已启用分支保护：**PR 的 `verify` 检查未通过时无法合并**。当前 `enforce_admins=false`，管理员可直接 push main 或 `--admin` 合并，属于单人开发的效率取舍。

**必须走 PR 的改动**（改动即契约，需要 CI 全绿作为证据）：

| 目录 / 文件 | 原因 |
|---|---|
| `packages/shared/` | 金额与状态机唯一实现，错了影响所有链路 |
| `openapi.yaml` | 接口契约来源，需契约测试验证 |
| `apps/api/prisma/` | 迁移只增不毁，需在空库验证可执行性 |
| `packages/tokens/`、`eslint.config.mjs` | 视觉与静态规则本身 |
| `.github/`、`CODEOWNERS` | 门禁配置自身 |

其余改动（页面文案、样式微调、内部实现）可直接推 main，CI 仍会跑，红灯当次修复。

**有第二名开发者加入时**，必须把 `enforce_admins` 改为 `true`，否则分支保护对管理员无效。

## 当前进度

- **M0 完成**：monorepo、共享金额/状态机（30 个单测，覆盖率 98%）、Prisma 19 表迁移、种子数据、四角色登录、统一响应与错误码、Swagger、CI 与 ESLint 契约门禁。
- **M1 完成**：购物车（含失效区）→ 结算预览（会员折扣 + 券 + 满额包邮）→ 下单（幂等键 + 行锁预占）→ 模拟支付（回调幂等）→ 后台发货。并发验证：40 并发抢 10 件库存，成功恰为 10、无负库存。
- **M2 完成**：售后申请与审核（仅退款 / 退货退款 / 拒绝恢复）、退款执行（幂等、累计不超实付、整单退含运费、未发货回滚库存）、超时关单定时任务（每分钟，释放预占）、物流详情节点。契约测试 15 条。
- **M3 完成**：优惠券（后台建券 / 指定或全量发放 / 小程序领取 / 下单核销 / 取消与整单退款退券 / 超时关单退券）、会员等级（按累计消费自动升降级、折扣作用于商品金额）、积分（支付发放、退款扣回、后台手动调整，均记流水且余额不为负）、客户列表与详情、评价（仅已完成订单可评、先审后显、商家回复）、确认收货。契约测试新增 8 条，共 23 条。
- **M4 完成**：补齐地址簿、商品/分类/标签、店铺设置/运费/素材、子账号、操作日志（写操作自动审计）、数据概览接口；`openapi-typescript` 接入类型生成；管理后台 24 页（React + Vite）与小程序 21 页（Taro 4）全部接通真实接口；CI 增加两端构建。契约测试共 33 条。
- **工程质量加固完成**：契约测试独立测试库、Playwright 主链路 E2E、客户端错误上报（`POST /api/telemetry/client-error` + 5xx/慢请求结构化日志 + `x-request-id` 响应头）、登录与上报接口限流、生产环境 `JWT_SECRET` 强度校验、数据库备份脚本。
- **集成配置完成**：后台「设置 → 集成配置」维护小程序 AppID/AppSecret、微信支付商户参数、订阅消息模板与业务域名；AppSecret 为文本框录入（接口不回显），支付密钥/证书以文件上传并仅存服务端（`apps/api/uploads/secrets`），接口与审计日志均不返回明文，小程序登录与支付渠道按配置生效。
- **小程序发布完成**：后台「设置 → 小程序发布」可一键构建 weapp（`dist-weapp`）、用 miniprogram-ci 上传开发版并生成体验版二维码，记录版本与日志；审核/发布在微信公众平台完成（官方未开放自建小程序的审核发布 API），支持标记已发布。
- **二期完成（本地）**：订阅消息与退款对账、批量发货与首页运营位、评价晒图、付费会员卡与储值、满减/秒杀与经营看板。
- **三期迭代 A 完成**：轻量多门店、门店级库存与并发防超卖、订单履约方式分流与门店归属、门店账号数据隔离、门店库存流水、门店看板 v1；契约测试共 71 条，E2E 7 条。
- **三期迭代 B 完成**：自提下单（免运费、门店/时段与门店库存校验）、支付后 8 位唯一核销码与过期时间、后台核销台（跨店 404、重复核销幂等、限流、操作日志）、超时自动完成（到期前 1 天提醒、`AUTO` 记录、不回滚库存）、小程序结算履约方式与门店选择、订单详情核销码/二维码/门店营业时间；契约测试 76 条，E2E 8 条。
- **三期迭代 C 完成**：同城配送（门店区县白名单、配送费/满额免配送、时段截单与每时段容量）、支付后创建配送单、后台接单/送达/取消与门店数据范围、配送通知、结算页配送门店与时段、订单详情配送状态/配送员/联系入口、门店看板平均接单与送达时长及超时单；契约测试 82 条，E2E 11 条。
- **三期迭代 D 完成（本地）**：全文搜索（`pg_trgm` + GIN 索引、标题/副标题/分类/标签/拼音生成 `searchText`、历史商品回填）、`GET /api/products` 关键词/价格/标签/门店筛选与综合/销量/价格/新品排序、搜索日志与热词/无结果词统计及后台看板、小程序搜索页（历史、热词、筛选、排序、无结果推荐）；1 万 SKU 基准 P95 20.1ms、两字中文召回 100%；契约测试 89 条，E2E 11 条。基准脚本：`db:bench-seed` / `search:bench` / `db:bench-clean`。
- **下一步**：真实支付真机验收与储值合规作为上线前置。
