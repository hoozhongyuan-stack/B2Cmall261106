import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

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
}

export interface CreateRegionInput {
  regionName: string;
  freightCents: number;
}

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

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
      regions: regions.map((r) => ({
        id: r.id,
        regionName: r.regionName,
        freightCents: r.freightCents,
      })),
    };
  }

  async update(input: UpdateShopInput) {
    const shopName = this.optionalText(input.shopName, '店铺名称');
    if (input.logoKey !== undefined) await this.assets.assertReference(input.logoKey);

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
