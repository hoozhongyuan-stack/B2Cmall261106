import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { PrismaService } from '../../prisma/prisma.module';
import { ASSET_URL_PREFIX, assetsDir, assetUrl } from '../../common/media';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface ImageSpec {
  ext: string;
  matches: (buffer: Buffer) => boolean;
}

/** 白名单：扩展名由服务端决定，文件头必须与声明类型一致 */
const IMAGE_SPECS: Record<string, ImageSpec> = {
  'image/jpeg': {
    ext: 'jpg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/png': {
    ext: 'png',
    matches: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/gif': {
    ext: 'gif',
    matches: (b) => {
      const head = b.subarray(0, 6).toString('ascii');
      return head === 'GIF87a' || head === 'GIF89a';
    },
  },
  'image/webp': {
    ext: 'webp',
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
};

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 素材列表 ---------------- */

  async list(query: { folderId?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const keyword = query.keyword?.trim();

    const where = {
      ...(query.folderId === 'none'
        ? { folderId: null }
        : query.folderId
          ? { folderId: query.folderId }
          : {}),
      ...(keyword
        ? {
            OR: [
              { key: { contains: keyword, mode: 'insensitive' as const } },
              { originalName: { contains: keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: { folder: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.asset.count({ where }),
    ]);

    const counts = await this.refCounts(rows.map((row) => row.key));
    return {
      total,
      page,
      pageSize,
      items: rows.map((row) => this.view(row, counts.get(row.key) ?? 0)),
    };
  }

  /* ---------------- 文件夹 ---------------- */

  async folders() {
    const [items, grouped, uncategorized] = await Promise.all([
      this.prisma.assetFolder.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.asset.groupBy({ by: ['folderId'], _count: { _all: true } }),
      this.prisma.asset.count({ where: { folderId: null } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.folderId ?? 'none', g._count._all]));

    return {
      total: items.reduce((sum, folder) => sum + (counts.get(folder.id) ?? 0), 0) + uncategorized,
      uncategorized,
      items: items.map((folder) => ({
        id: folder.id,
        name: folder.name,
        sort: folder.sort,
        count: counts.get(folder.id) ?? 0,
        createdAt: folder.createdAt,
      })),
    };
  }

  async createFolder(input: { name: string; sort?: number }) {
    const name = this.folderName(input.name);
    try {
      return await this.prisma.assetFolder.create({
        data: { name, sort: this.nonNegativeInt(input.sort) },
      });
    } catch (err) {
      if (this.isUniqueError(err)) throw new ConflictException('文件夹名称已存在');
      throw err;
    }
  }

  async updateFolder(id: string, input: { name?: string; sort?: number }) {
    const folder = await this.prisma.assetFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('文件夹不存在');

    try {
      return await this.prisma.assetFolder.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: this.folderName(input.name) } : {}),
          ...(input.sort !== undefined ? { sort: this.nonNegativeInt(input.sort) } : {}),
        },
      });
    } catch (err) {
      if (this.isUniqueError(err)) throw new ConflictException('文件夹名称已存在');
      throw err;
    }
  }

  async deleteFolder(id: string) {
    const folder = await this.prisma.assetFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('文件夹不存在');

    const count = await this.prisma.asset.count({ where: { folderId: id } });
    if (count > 0) {
      throw new ConflictException(`文件夹内还有 ${count} 张图片，请先移动或删除`);
    }

    await this.prisma.assetFolder.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------------- 上传 / 移动 / 删除 ---------------- */

  async upload(files: UploadedImage[], folderIdInput?: string) {
    if (!files?.length) throw new BadRequestException('请选择要上传的图片');
    const folderId = await this.resolveFolder(folderIdInput);

    // 先整体校验，避免部分文件落盘后才发现格式错误
    const prepared = files.map((file) => ({ file, spec: this.validateImage(file) }));

    const created: Array<{ id: string; key: string; url: string }> = [];
    for (const { file, spec } of prepared) {
      const now = new Date();
      const storageKey =
        `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/` +
        `${now.getTime().toString(36)}-${randomBytes(5).toString('hex')}.${spec.ext}`;
      const target = join(assetsDir(), storageKey);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.buffer, { mode: 0o644 });

      const url = assetUrl(storageKey);
      try {
        const asset = await this.prisma.asset.create({
          data: {
            key: url,
            url,
            storageKey,
            originalName: this.originalName(file.originalname),
            size: file.size,
            mimeType: file.mimetype,
            folderId,
          },
        });
        created.push({ id: asset.id, key: asset.key, url: asset.url });
      } catch (err) {
        await unlink(target).catch(() => undefined);
        throw err;
      }
    }

    return { items: created };
  }

  async move(id: string, folderIdInput: string | null | undefined) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('素材不存在');

    const folderId = await this.resolveFolder(folderIdInput ?? undefined);
    return this.prisma.asset.update({ where: { id }, data: { folderId } });
  }

  async remove(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('素材不存在');

    const refCount = await this.refCount(asset.key);
    if (refCount > 0) {
      throw new ConflictException(`素材已被引用（${refCount} 处），不能删除`);
    }

    await this.prisma.asset.delete({ where: { id } });
    if (asset.storageKey) {
      await unlink(join(assetsDir(), asset.storageKey)).catch(() => undefined);
    }
    return { deleted: true };
  }

  /** 批量删除：被引用的素材逐条失败并返回原因 */
  async batchRemove(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) throw new BadRequestException('请选择素材');
    const errors: { id: string; message: string }[] = [];
    let success = 0;
    for (const id of unique) {
      try {
        await this.remove(id);
        success += 1;
      } catch (error) {
        errors.push({ id, message: error instanceof Error ? error.message : '删除失败' });
      }
    }
    return { total: unique.length, success, failed: errors.length, errors };
  }

  /**
   * 业务侧引用校验：图片只能来自素材库。
   * 历史静态素材（如 products/honey.jpg）继续兼容，外链一律拒绝。
   */
  async assertReference(key: string | null | undefined): Promise<void> {
    const value = (key ?? '').trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      throw new BadRequestException('图片必须从素材库选择，不能直接使用外链');
    }
    if (value.startsWith(ASSET_URL_PREFIX)) {
      const exists = await this.prisma.asset.findUnique({
        where: { key: value },
        select: { id: true },
      });
      if (!exists) throw new BadRequestException('所选图片已不存在，请重新选择');
    }
  }

  /** 多图引用校验（主图轮播 / 详情图） */
  async assertReferences(keys: string[] | null | undefined): Promise<void> {
    for (const key of keys ?? []) {
      await this.assertReference(key);
    }
  }

  /* ---------------- 内部 ---------------- */

  private view(
    row: {
      id: string;
      key: string;
      url: string;
      storageKey: string | null;
      originalName: string | null;
      size: number;
      mimeType: string | null;
      folderId: string | null;
      createdAt: Date;
      folder: { id: string; name: string } | null;
    },
    refCount: number,
  ) {
    return {
      id: row.id,
      key: row.key,
      url: row.url,
      storageKey: row.storageKey,
      // 历史数据可能已按 latin1 存成乱码，展示时一并还原
      originalName: row.originalName ? this.decodeName(row.originalName) : null,
      size: row.size,
      mimeType: row.mimeType,
      folderId: row.folderId,
      folderName: row.folder?.name ?? null,
      refCount,
      createdAt: row.createdAt,
    };
  }

  private validateImage(file: UploadedImage): ImageSpec {
    if (!file?.buffer?.length) throw new BadRequestException('图片内容为空');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('单张图片不能超过 5MB');

    const spec = IMAGE_SPECS[file.mimetype];
    if (!spec) throw new BadRequestException('仅支持 JPG / PNG / WEBP / GIF 图片');
    if (!spec.matches(file.buffer)) {
      throw new BadRequestException(`${this.originalName(file.originalname)} 的内容与格式不符`);
    }
    return spec;
  }

  private async resolveFolder(value?: string): Promise<string | null> {
    const raw = (value ?? '').trim();
    if (!raw || raw === 'none' || raw === 'all') return null;

    const folder = await this.prisma.assetFolder.findUnique({ where: { id: raw } });
    if (!folder) throw new BadRequestException('文件夹不存在');
    return raw;
  }

  private async refCounts(keys: string[]): Promise<Map<string, number>> {
    if (!keys.length) return new Map();

    const [products, logo] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          OR: [
            { mainImageKey: { in: keys } },
            { mainImageKeys: { hasSome: keys } },
            { detailImageKeys: { hasSome: keys } },
          ],
        },
        select: { mainImageKey: true, mainImageKeys: true, detailImageKeys: true },
      }),
      this.prisma.shopConfig.findFirst({ select: { logoKey: true } }),
    ]);

    const counts = new Map<string, number>();
    for (const product of products) {
      const referenced = new Set<string>();
      if (product.mainImageKey) referenced.add(product.mainImageKey);
      for (const key of product.mainImageKeys) referenced.add(key);
      for (const key of product.detailImageKeys) referenced.add(key);

      for (const key of referenced) {
        if (keys.includes(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    if (logo?.logoKey && keys.includes(logo.logoKey)) {
      counts.set(logo.logoKey, (counts.get(logo.logoKey) ?? 0) + 1);
    }
    return counts;
  }

  private async refCount(key: string): Promise<number> {
    return (await this.refCounts([key])).get(key) ?? 0;
  }

  private folderName(value: string): string {
    const name = (value ?? '').trim();
    if (!name) throw new BadRequestException('文件夹名称不能为空');
    if (name.length > 30) throw new BadRequestException('文件夹名称不能超过 30 个字符');
    return name;
  }

  private nonNegativeInt(value?: number): number {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException('排序必须为非负整数');
    }
    return value;
  }

  /**
   * 浏览器上传的中文文件名会被 multipart 解析器按 latin1 读出，
   * 这里检测并还原为 UTF-8；已是正常中文则原样返回。
   */
  private decodeName(value: string): string {
    const name = basename(value ?? '').trim();
    if (!name) return '';
    if (!/[\u0080-\u00ff]/.test(name)) return name;

    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  }

  private originalName(value: string): string {
    const name = this.decodeName(value).slice(0, 120);
    return name || '未命名图片';
  }

  private isUniqueError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
  }
}
