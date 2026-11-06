import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readdir, readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Project, preview, upload } from 'miniprogram-ci';

import { PrismaService } from '../../prisma/prisma.module';
import { IntegrationService } from '../integration/integration.service';

const LOG_LIMIT = 20_000;
const STALE_BUILD_MS = 15 * 60_000;

const STATUS_TEXT: Record<string, string> = {
  BUILDING: '构建中',
  UPLOADED: '已上传',
  FAILED: '失败',
  RELEASED: '已发布',
};

@Injectable()
export class MiniappReleaseService {
  private readonly logger = new Logger(MiniappReleaseService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
  ) {}

  async readiness() {
    const config = await this.integration.miniappPublishConfig();
    const latest = await this.prisma.miniappRelease.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    return {
      appId: config.appId,
      uploadKey: { configured: Boolean(config.uploadKeyPath) },
      apiBaseUrl: config.apiBaseUrl,
      buildAvailable: Boolean(config.appId && config.uploadKeyPath),
      latestRelease: latest ? this.toView(latest) : null,
      suggestedVersion: this.nextVersion(latest?.version ?? null),
    };
  }

  async list() {
    const rows = await this.prisma.miniappRelease.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { items: rows.map((row) => this.toView(row)) };
  }

  async detail(id: string) {
    const row = await this.prisma.miniappRelease.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('发布记录不存在');
    return { ...this.toView(row), log: row.log ?? '' };
  }

  async create(operator: { sub: string; name?: string }, version: string, description: string) {
    const normalized = this.version(version);
    const desc = (description ?? '').trim();
    if (!desc) throw new BadRequestException('请填写更新说明');
    if (desc.length > 200) throw new BadRequestException('更新说明不能超过 200 字');

    const config = await this.integration.miniappPublishConfig();
    if (!config.appId) throw new BadRequestException('请先在集成配置中填写小程序 AppID');
    if (!config.uploadKeyPath || !existsSync(config.uploadKeyPath)) {
      throw new BadRequestException('请先在集成配置中上传小程序代码上传密钥');
    }

    await this.failStaleBuilding();
    if (this.running) throw new ConflictException('已有构建任务进行中，请稍后再试');
    const building = await this.prisma.miniappRelease.findFirst({
      where: { status: 'BUILDING' },
    });
    if (building) throw new ConflictException('已有构建任务进行中，请稍后再试');

    const row = await this.prisma.miniappRelease.create({
      data: {
        version: normalized,
        description: desc,
        status: 'BUILDING',
        operatorId: operator.sub,
        operatorName: operator.name ?? '',
      },
    });

    void this.run(row.id, normalized, desc, config).catch((err) => {
      this.logger.error(`发布任务异常：${err instanceof Error ? err.stack : String(err)}`);
    });

    return this.toView(row);
  }

  async qrcode(id: string) {
    const row = await this.prisma.miniappRelease.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('发布记录不存在');
    if (!row.qrCodePath || !existsSync(row.qrCodePath)) {
      throw new NotFoundException('该版本还没有体验版二维码');
    }
    const buffer = await readFile(row.qrCodePath);
    return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` };
  }

  /** 审核与发布在微信后台完成，这里只做状态回填 */
  async markReleased(id: string) {
    const row = await this.prisma.miniappRelease.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('发布记录不存在');
    if (row.status !== 'UPLOADED' && row.status !== 'RELEASED') {
      throw new BadRequestException('只有已上传的版本才能标记为已发布');
    }
    const updated = await this.prisma.miniappRelease.update({
      where: { id },
      data: { status: 'RELEASED' },
    });
    return this.toView(updated);
  }

  /* ---------------- 构建与上传 ---------------- */

  private async run(
    id: string,
    version: string,
    description: string,
    config: { appId: string; uploadKeyPath: string | null; apiBaseUrl: string },
  ): Promise<void> {
    this.running = true;
    let log = '';
    const append = (chunk: string) => {
      log = `${log}${chunk}`.slice(-LOG_LIMIT);
    };

    const apiBase = config.apiBaseUrl || 'https://car.aition.art/api';

    try {
      append(`[${new Date().toISOString()}] 开始构建 weapp，API_BASE=${apiBase}\n`);
      await this.build(apiBase, append);
      const outputDir = join(this.repoRoot(), 'apps/miniapp/dist-weapp');
      const size = await this.dirSize(outputDir);
      append(`[构建完成] 产物 ${outputDir}，大小 ${(size / 1024).toFixed(1)}KB\n`);

      append('[上传] 调用 miniprogram-ci upload\n');
      const project = new Project({
        appid: config.appId,
        type: 'miniProgram',
        projectPath: join(this.repoRoot(), 'apps/miniapp'),
        privateKeyPath: config.uploadKeyPath ?? undefined,
        ignores: ['node_modules/**/*'],
      });
      await upload({ project, version, desc: description, robot: 1, threads: 1 });

      append('[体验版] 生成二维码\n');
      const qrPath = join(this.uploadRoot(), 'miniapp', `qr-${id}.jpg`);
      await mkdir(dirname(qrPath), { recursive: true });
      await preview({
        project,
        version,
        desc: description,
        robot: 1,
        qrcodeFormat: 'image',
        qrcodeOutputDest: qrPath,
        pagePath: 'pages/home/index',
      });

      await this.prisma.miniappRelease.update({
        where: { id },
        data: { status: 'UPLOADED', size, qrCodePath: qrPath, log },
      });
      append('[完成] 开发版已上传，可在微信后台提交审核\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      append(`\n[失败] ${message}\n`);
      await this.prisma.miniappRelease.update({
        where: { id },
        data: { status: 'FAILED', log },
      });
    } finally {
      this.running = false;
    }
  }

  private build(apiBase: string, onLog: (chunk: string) => void): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.pnpmBin(), ['--filter', '@shanye/miniapp', 'build:weapp'], {
        cwd: this.repoRoot(),
        env: {
          ...process.env,
          API_BASE: apiBase,
          TARO_OUTPUT_ROOT: 'dist-weapp',
          NODE_ENV: 'production',
        },
      });
      child.stdout.on('data', (data: Buffer) => onLog(data.toString()));
      child.stderr.on('data', (data: Buffer) => onLog(data.toString()));
      child.on('error', (err) => reject(new Error(`无法启动构建进程：${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`构建失败，退出码 ${code}`));
      });
    });
  }

  private async dirSize(dir: string): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) total += await this.dirSize(full);
      else total += (await stat(full)).size;
    }
    return total;
  }

  private async failStaleBuilding(): Promise<void> {
    const stale = await this.prisma.miniappRelease.findFirst({
      where: { status: 'BUILDING', updatedAt: { lt: new Date(Date.now() - STALE_BUILD_MS) } },
    });
    if (!stale) return;
    await this.prisma.miniappRelease.update({
      where: { id: stale.id },
      data: { status: 'FAILED', log: '构建超过 15 分钟未完成，已标记失败' },
    });
  }

  /* ---------------- 工具 ---------------- */

  private repoRoot(): string {
    return process.env.REPO_ROOT ?? resolve(process.cwd(), '../..');
  }

  private uploadRoot(): string {
    return process.env.UPLOAD_DIR
      ? resolve(process.env.UPLOAD_DIR)
      : resolve(process.cwd(), 'uploads');
  }

  private pnpmBin(): string {
    return process.env.PNPM_BIN ?? 'pnpm';
  }

  private version(value: string): string {
    const text = (value ?? '').trim();
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) {
      throw new BadRequestException('版本号格式应为 x.y.z，例如 1.0.1');
    }
    return text;
  }

  private nextVersion(latest: string | null): string {
    if (!latest) return '1.0.0';
    const [major, minor, patch] = latest.split('.').map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }

  private toView(row: {
    id: string;
    version: string;
    description: string;
    status: string;
    size: number;
    qrCodePath: string | null;
    operatorName: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      version: row.version,
      description: row.description,
      status: row.status,
      statusText: STATUS_TEXT[row.status] ?? row.status,
      size: row.size,
      hasQrCode: Boolean(row.qrCodePath),
      operatorName: row.operatorName ?? '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
