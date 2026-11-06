import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';

const SHOP_CONFIG_ID = 'singleton';

export interface UpdateShopInput {
  shopName?: string;
  intro?: string;
  servicePhone?: string;
  logoKey?: string;
  freeThresholdCents?: number;
  flatFreightCents?: number;
  payTimeoutMinutes?: number;
  afterSaleDays?: number;
  autoConfirmDays?: number;
  miniappAppId?: string;
}

export interface CreateRegionInput {
  regionName: string;
  freightCents: number;
}

export interface CreateAssetInput {
  key: string;
  url: string;
  size?: number;
  mimeType?: string;
  group?: string;
}

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 店铺设置 ---------------- */

  async detail() {
    const config = await this.ensureConfig();
    const regions = await this.prisma.shippingRegionException.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return {
      shopName: config.shopName,
      intro: config.intro,
      servicePhone: config.servicePhone,
      logoKey: config.logoKey,
      freeThresholdCents: config.freeThresholdCents,
      flatFreightCents: config.flatFreightCents,
      payTimeoutMinutes: config.payTimeoutMinutes,
      afterSaleDays: config.afterSaleDays,
      autoConfirmDays: config.autoConfirmDays,
      miniappAppId: config.miniappAppId,
      regions: regions.map((r) => ({
        id: r.id,
        regionName: r.regionName,
        freightCents: r.freightCents,
      })),
    };
  }

  async update(input: UpdateShopInput) {
    const shopName = this.optionalText(input.shopName, '店铺名称');

    const data = {
      ...(shopName !== undefined ? { shopName } : {}),
      ...(input.intro !== undefined ? { intro: input.intro } : {}),
      ...(input.servicePhone !== undefined ? { servicePhone: input.servicePhone } : {}),
      ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
      ...(input.freeThresholdCents !== undefined
        ? { freeThresholdCents: this.nonNegativeInt(input.freeThresholdCents, '包邮门槛') }
        : {}),
      ...(input.flatFreightCents !== undefined
        ? { flatFreightCents: this.nonNegativeInt(input.flatFreightCents, '基础运费') }
        : {}),
      ...(input.payTimeoutMinutes !== undefined
        ? { payTimeoutMinutes: this.nonNegativeInt(input.payTimeoutMinutes, '支付超时时间') }
        : {}),
      ...(input.afterSaleDays !== undefined
        ? { afterSaleDays: this.nonNegativeInt(input.afterSaleDays, '售后期天数') }
        : {}),
      ...(input.autoConfirmDays !== undefined
        ? { autoConfirmDays: this.nonNegativeInt(input.autoConfirmDays, '自动确认收货天数') }
        : {}),
      ...(input.miniappAppId !== undefined ? { miniappAppId: input.miniappAppId } : {}),
    };

    await this.ensureConfig();
    return this.prisma.shopConfig.update({ where: { id: SHOP_CONFIG_ID }, data });
  }

  async createRegion(input: CreateRegionInput) {
    const regionName = this.requireText(input.regionName, '偏远地区名称');
    const freightCents = this.nonNegativeInt(input.freightCents, '运费');

    return this.prisma.shippingRegionException.create({ data: { regionName, freightCents } });
  }

  async removeRegion(id: string) {
    const region = await this.prisma.shippingRegionException.findUnique({ where: { id } });
    if (!region) throw new NotFoundException('地区运费规则不存在');

    await this.prisma.shippingRegionException.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------------- 素材 ---------------- */

  async listAssets(query: { group?: string; keyword?: string }) {
    const keyword = query.keyword?.trim();
    const items = await this.prisma.asset.findMany({
      where: {
        ...(query.group ? { group: query.group } : {}),
        ...(keyword ? { key: { contains: keyword, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items };
  }

  async createAsset(input: CreateAssetInput) {
    const key = this.requireText(input.key, '素材 key');
    const url = this.requireText(input.url, '素材地址');
    const size = input.size === undefined ? 0 : this.nonNegativeInt(input.size, '素材大小');

    try {
      return await this.prisma.asset.create({
        data: {
          key,
          url,
          size,
          mimeType: input.mimeType,
          group: input.group?.trim() || 'default',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('素材 key 已存在');
      throw err;
    }
  }

  async removeAsset(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('素材不存在');
    if (asset.refCount > 0) throw new ConflictException('素材已被引用，不能删除');

    await this.prisma.asset.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureConfig() {
    return this.prisma.shopConfig.upsert({
      where: { id: SHOP_CONFIG_ID },
      update: {},
      create: { id: SHOP_CONFIG_ID },
    });
  }

  private requireText(value: string | undefined, label: string): string {
    const text = this.optionalText(value, label);
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }

  private optionalText(value: string | undefined, label: string): string | undefined {
    if (value === undefined) return undefined;
    const text = value.trim();
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }

  private nonNegativeInt(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label}必须为非负整数`);
    }
    return value;
  }
}
