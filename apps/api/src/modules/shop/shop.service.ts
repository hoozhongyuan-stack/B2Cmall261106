import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

const SHOP_CONFIG_ID = 'singleton';

export interface UpdateShopInput {
  shopName?: string;
  intro?: string;
  servicePhone?: string;
  logoKey?: string;
  serviceEmail?: string | null;
  serviceWechat?: string | null;
  serviceHours?: string | null;
  companyAddress?: string | null;
  companyName?: string | null;
  creditCode?: string | null;
  icpNumber?: string | null;
  icpUrl?: string | null;
  policeNumber?: string | null;
  policeUrl?: string | null;
  officialSiteUrl?: string | null;
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

/** 店铺资料文本字段的局部更新；只包含请求里显式传入的键 */
interface ShopTextPatch {
  serviceEmail?: string | null;
  serviceWechat?: string | null;
  serviceHours?: string | null;
  companyAddress?: string | null;
  companyName?: string | null;
  creditCode?: string | null;
  icpNumber?: string | null;
  icpUrl?: string | null;
  policeNumber?: string | null;
  policeUrl?: string | null;
  officialSiteUrl?: string | null;
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
      serviceEmail: config.serviceEmail,
      serviceWechat: config.serviceWechat,
      serviceHours: config.serviceHours,
      companyAddress: config.companyAddress,
      companyName: config.companyName,
      creditCode: config.creditCode,
      icpNumber: config.icpNumber,
      icpUrl: config.icpUrl,
      policeNumber: config.policeNumber,
      policeUrl: config.policeUrl,
      officialSiteUrl: config.officialSiteUrl,
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
    const servicePhone =
      input.servicePhone !== undefined
        ? this.phone(this.optionalText(input.servicePhone, '客服电话'), '客服电话')
        : undefined;

    const data = {
      ...(shopName !== undefined ? { shopName } : {}),
      ...(input.intro !== undefined ? { intro: input.intro } : {}),
      ...(servicePhone !== undefined ? { servicePhone } : {}),
      ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
      ...this.textFields(input),
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

  /** 联系方式 / 主体备案 / 官方站点：统一 trim、空串存 null，并按字段校验 */
  private textFields(input: UpdateShopInput): ShopTextPatch {
    const serviceEmail =
      input.serviceEmail === undefined
        ? undefined
        : this.nullableText(input.serviceEmail, '客服邮箱', 80);
    if (serviceEmail) this.email(serviceEmail);

    const creditCode =
      input.creditCode === undefined
        ? undefined
        : this.nullableText(input.creditCode, '统一社会信用代码', 18);
    if (creditCode && !/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) {
      throw new BadRequestException('统一社会信用代码格式不正确');
    }

    const serviceWechat = this.nullableField(input.serviceWechat, '客服微信', 40);
    const serviceHours = this.nullableField(input.serviceHours, '服务时间', 40);
    const companyAddress = this.nullableField(input.companyAddress, '公司地址', 120);
    const companyName = this.nullableField(input.companyName, '公司名称', 60);
    const icpNumber = this.nullableField(input.icpNumber, 'ICP 备案号', 40);
    const policeNumber = this.nullableField(input.policeNumber, '公安备案号', 40);

    const icpUrl = this.nullableField(input.icpUrl, 'ICP 备案链接', 200);
    if (icpUrl) this.httpUrl(icpUrl, 'ICP 备案链接');
    const policeUrl = this.nullableField(input.policeUrl, '公安备案链接', 200);
    if (policeUrl) this.httpUrl(policeUrl, '公安备案链接');
    const officialSiteUrl = this.nullableField(input.officialSiteUrl, '官方商城地址', 200);
    if (officialSiteUrl) this.httpUrl(officialSiteUrl, '官方商城地址');

    return {
      ...(serviceEmail !== undefined ? { serviceEmail } : {}),
      ...(serviceWechat !== undefined ? { serviceWechat } : {}),
      ...(serviceHours !== undefined ? { serviceHours } : {}),
      ...(companyAddress !== undefined ? { companyAddress } : {}),
      ...(companyName !== undefined ? { companyName } : {}),
      ...(creditCode !== undefined ? { creditCode } : {}),
      ...(icpNumber !== undefined ? { icpNumber } : {}),
      ...(icpUrl !== undefined ? { icpUrl } : {}),
      ...(policeNumber !== undefined ? { policeNumber } : {}),
      ...(policeUrl !== undefined ? { policeUrl } : {}),
      ...(officialSiteUrl !== undefined ? { officialSiteUrl } : {}),
    };
  }

  private nullableField(
    value: string | null | undefined,
    label: string,
    max: number,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    return this.nullableText(value, label, max);
  }

  private nullableText(value: string | null, label: string, max: number): string | null {
    const text = (value ?? '').trim();
    if (!text) return null;
    if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字符`);
    return text;
  }

  private phone(value: string | undefined, label: string): string | undefined {
    if (!value) return value;
    if (!/^[0-9+\-\s]{7,20}$/.test(value)) {
      throw new BadRequestException(`${label}格式不正确`);
    }
    return value;
  }

  private email(value: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new BadRequestException('客服邮箱格式不正确');
    }
  }

  private httpUrl(value: string, label: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException(`${label}格式不正确`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(`${label}必须以 http(s):// 开头`);
    }
  }
}
