import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let child: ChildProcess | null = null;

export function contractBaseUrl(): string {
  return `http://127.0.0.1:${process.env.CONTRACT_PORT ?? 3100}/api`;
}

function readEnvFile(): Record<string, string> {
  const root = join(__dirname, '../../../..');
  const envPath = join(root, 'apps/api/.env');
  const parsed: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) parsed[m[1]] = m[2];
    }
  }
  return parsed;
}

function loadEnv(): NodeJS.ProcessEnv {
  const parsed = readEnvFile();
  // 优先使用独立测试库，避免契约测试把演示数据洗掉
  if (parsed.TEST_DATABASE_URL) parsed.DATABASE_URL = parsed.TEST_DATABASE_URL;
  parsed.PORT = String(process.env.CONTRACT_PORT ?? 3100);
  return parsed;
}

function runSync(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败（退出码 ${result.status}）`);
  }
}

/** 独立测试库每次从空库重建，保证契约测试可重复 */
function prepareTestDatabase(root: string, env: NodeJS.ProcessEnv): void {
  if (!env.TEST_DATABASE_URL) return;
  const apiDir = join(root, 'apps/api');
  // --skip-seed：Prisma 的 reset 默认会自动跑种子，这里改为显式执行一次，避免重复灌数据
  runSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-generate', '--skip-seed'],
    apiDir,
    env,
  );
  runSync('pnpm', ['db:seed'], apiDir, env);
}

/** 全局只启动一次构建产物，避免多个测试文件争抢端口 */
export async function setup(): Promise<void> {
  const root = join(__dirname, '../../../..');
  const env = loadEnv();

  prepareTestDatabase(root, env);

  child = spawn('node', ['dist/main.js'], {
    cwd: join(root, 'apps/api'),
    env,
    // CI 上把服务端日志带到作业日志，便于定位契约测试中的 5xx
    stdio: process.env.CI ? 'inherit' : 'ignore',
  });

  const base = contractBaseUrl();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill('SIGTERM');
  throw new Error('契约测试启动 API 失败：30 秒内未就绪');
}

export async function teardown(): Promise<void> {
  child?.kill('SIGTERM');
  child = null;
}
