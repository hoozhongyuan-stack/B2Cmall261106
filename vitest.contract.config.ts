import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 读取 apps/api/.env，注入测试进程（契约测试需要 DATABASE_URL） */
function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, 'apps/api/.env');
  const out: Record<string, string> = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const fileEnv = loadEnv();
/** 配置了独立测试库时，测试进程内的数据库访问也走它 */
const testDatabaseUrl = fileEnv.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

/** 契约测试：需要真实数据库与构建产物，单独配置以便 pnpm test 不依赖库 */
export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.contract.test.ts'],
    globalSetup: ['./apps/api/test/contract/global-setup.ts'],
    env: {
      ...fileEnv,
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
    },
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
