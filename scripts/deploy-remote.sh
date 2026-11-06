#!/usr/bin/env bash
# 一键部署到腾讯云联调环境（car.aition.art）
# 用法：pnpm deploy:remote
# 前置：本机 ~/.ssh/config 已配置 aition-prod（HostName 43.153.119.73, User ubuntu）
set -euo pipefail

HOST="${DEPLOY_HOST:-aition-prod}"
APP_DIR="${DEPLOY_DIR:-/opt/shanye}"
API_BASE_URL="${DEPLOY_API_BASE:-https://car.aition.art/api}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="/home/ubuntu/.nvm/versions/node/v22.23.4/bin"

echo "▸ 1/6 构建管理后台（子路径 /admin/）与小程序 H5（指向 ${API_BASE_URL}）"
(cd "$ROOT" && ADMIN_BASE=/admin/ pnpm --filter @shanye/admin build >/dev/null)
(cd "$ROOT" && API_BASE="$API_BASE_URL" pnpm --filter @shanye/miniapp build:h5 >/dev/null)

echo "▸ 2/6 同步代码与产物到 $HOST:$APP_DIR"
rsync -az --delete \
  --exclude 'node_modules' --exclude '.git' --exclude '.env' \
  --exclude 'apps/miniapp/dist' --exclude 'apps/admin/dist' \
  --exclude 'backups' --exclude 'uploads' --exclude 'coverage' \
  --exclude 'test-results' --exclude 'playwright-report' \
  --exclude '.screenshots' --exclude '.trae-html-share-packages' --exclude '*.log' \
  "$ROOT/" "$HOST:$APP_DIR/"

rsync -az --delete "$ROOT/apps/admin/dist/" "$HOST:$APP_DIR/apps/admin/dist/"
rsync -az --delete "$ROOT/apps/miniapp/dist/" "$HOST:$APP_DIR/apps/miniapp/dist/"

echo "▸ 3/6 安装依赖（仅变更时）"
ssh "$HOST" "export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd $APP_DIR && pnpm install --frozen-lockfile 2>&1 | tail -3"

echo "▸ 4/6 数据库迁移"
ssh "$HOST" "export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd $APP_DIR && pnpm --filter @shanye/api exec prisma migrate deploy 2>&1 | tail -3"

echo "▸ 5/6 构建并重启 API"
ssh "$HOST" "export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd $APP_DIR && pnpm --filter @shanye/api exec prisma generate >/dev/null && pnpm build:api >/dev/null && sudo systemctl restart shanye-api"

echo "▸ 6/6 健康检查"
sleep 4
ssh "$HOST" "curl -s http://127.0.0.1:3101/api/health && echo" || {
  echo "健康检查失败，最近日志："; ssh "$HOST" "sudo journalctl -u shanye-api -n 30 --no-pager"; exit 1;
}

echo "✓ 部署完成：https://car.aition.art/（H5）  https://car.aition.art/admin/（后台）"
echo "  提示：本次本地 H5 产物已指向线上 API；如需本地预览请重新执行 pnpm --filter @shanye/miniapp build:h5"
echo "  服务器 Node 路径：${NODE_BIN}（换版本时请同步修改）"
