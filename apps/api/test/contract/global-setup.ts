import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let child: ChildProcess | null = null;

export function contractBaseUrl(): string {
  return `http://127.0.0.1:${process.env.CONTRACT_PORT ?? 3100}/api`;
}

function loadEnv(): NodeJS.ProcessEnv {
  const root = join(__dirname, '../../../..');
  const envPath = join(root, 'apps/api/.env');
  const parsed: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) parsed[m[1]] = m[2];
    }
  }
  parsed.PORT = String(process.env.CONTRACT_PORT ?? 3100);
  return parsed;
}

/** 全局只启动一次构建产物，避免多个测试文件争抢端口 */
export async function setup(): Promise<void> {
  const root = join(__dirname, '../../../..');
  child = spawn('node', ['dist/main.js'], {
    cwd: join(root, 'apps/api'),
    env: loadEnv(),
    stdio: 'ignore',
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
