#!/usr/bin/env bash
# 数据库逻辑备份：pg_dump → gzip，默认保留 7 天。
# 用法：pnpm db:backup
# 可用环境变量覆盖：DATABASE_URL / BACKUP_DIR / RETENTION_DAYS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" && -f "$ROOT/apps/api/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/apps/api/.env" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi

if [[ -z "$DATABASE_URL" ]]; then
  echo "未找到 DATABASE_URL：请在环境变量或 apps/api/.env 中配置" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "缺少 pg_dump，请先安装 PostgreSQL 客户端（brew install postgresql@16）" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/shanye-$STAMP.sql.gz"
TMP="$FILE.tmp"

# pg_dump 不认 Prisma 连接串里的 ?schema=public，需要去掉查询参数
PG_URL="${DATABASE_URL%%\?*}"

if ! pg_dump "$PG_URL" --no-owner --no-privileges | gzip > "$TMP"; then
  rm -f "$TMP"
  echo "备份失败" >&2
  exit 1
fi
mv "$TMP" "$FILE"
chmod 600 "$FILE"

echo "已备份：${FILE}（$(du -h "$FILE" | cut -f1)）"

# 素材图片同样落本机磁盘，纳入备份；目录不存在时跳过
UPLOAD_DIR="${UPLOAD_DIR:-}"
if [[ -z "$UPLOAD_DIR" && -f "$ROOT/apps/api/.env" ]]; then
  UPLOAD_DIR="$(grep -E '^UPLOAD_DIR=' "$ROOT/apps/api/.env" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi
UPLOAD_DIR="${UPLOAD_DIR:-$ROOT/apps/api/uploads}"
[[ "$UPLOAD_DIR" = /* ]] || UPLOAD_DIR="$ROOT/$UPLOAD_DIR"

if [[ -d "$UPLOAD_DIR/assets" ]]; then
  UPLOAD_FILE="$BACKUP_DIR/shanye-uploads-$STAMP.tar.gz"
  if ! tar -czf "$UPLOAD_FILE" -C "$UPLOAD_DIR" assets; then
    rm -f "$UPLOAD_FILE"
    echo "上传目录备份失败：$UPLOAD_DIR/assets" >&2
    exit 1
  fi
  chmod 600 "$UPLOAD_FILE"
  echo "已备份上传目录：${UPLOAD_FILE}（$(du -h "$UPLOAD_FILE" | cut -f1)）"
else
  echo "未找到上传目录：${UPLOAD_DIR}/assets（跳过图片备份）"
fi

# 清理超过保留期的备份，避免磁盘被撑满
find "$BACKUP_DIR" -type f \( -name 'shanye-*.sql.gz' -o -name 'shanye-uploads-*.tar.gz' \) -mtime +"$RETENTION_DAYS" -print -delete

echo "保留策略：$RETENTION_DAYS 天（数据库 + 上传目录）"
