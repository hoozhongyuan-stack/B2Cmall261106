import { defineConfig } from 'vitest/config';

/** 契约测试：需要真实数据库（DATABASE_URL），单独配置以便 pnpm test 不依赖库 */
export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.contract.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
