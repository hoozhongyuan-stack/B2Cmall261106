# 山野商城

B2C 商城：微信小程序（AppID `wx04619aa796c2188f`）+ 管理后台 + API。

产品与规则：[PRD](docs/B2C商城-需求调研与产品设计.html) · [技术方案](docs/tech/B2C商城-技术方案.html) · [设计规范](docs/ui/design-system.html) · [工程契约](docs/engineering/工程契约.html)

## 结构

```
apps/api          NestJS + Prisma（端口 3000，Swagger /api/docs）
packages/shared   金额计算与状态机（唯一实现，含单测）
packages/tokens   设计 token（颜色/字阶/间距，唯一来源）
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

pnpm --filter @shanye/api dev                    # http://127.0.0.1:3000/api/docs
```

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm lint` | 契约静态检查（裸色值 / 魔法字号 / 手写状态判断 / 跨层 import） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | 单测 |
| `pnpm test:coverage` | 单测 + packages/shared 覆盖率 90% 门槛 |
| `pnpm build:api` | 构建 API |

## 种子账号

| 账号 | 密码 | 角色 |
|---|---|---|
| admin@shanye.com | admin123 | 超级管理员 |
| ops@shanye.com | ops12345 | 商品运营 |
| cs@shanye.com | cs123456 | 客服 |
| wms@shanye.com | wms12345 | 仓储 |

## 开发流程与门禁

CI（`.github/workflows/ci.yml`）在每次 push 与 PR 上运行 8 个检查：Prepare types → Lint → Typecheck → Unit tests → Prisma migrate → Contract tests → Build → TODO guard。

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
- **下一步 M3**：优惠券领取与核销、会员等级折扣、积分发放与流水、客户列表与详情、评价管理。
