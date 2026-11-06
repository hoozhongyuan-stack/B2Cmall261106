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
| `pnpm test:contract` | 契约测试（需 API 可构建 + 数据库可写） |
| `pnpm codegen:api` | 由 openapi.yaml 生成 `packages/api-types` |
| `pnpm db:demo-reset` | 重置数据库并重新灌入演示数据（演示/录屏前执行，会清空契约测试留下的订单与评价） |
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
- **下一步**：真机联调、订阅消息、图片素材接入 CDN、弱网与空数据回归。
