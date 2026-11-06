import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

const PHONE_PATTERN = /^1\d{10}$/;
const MAX_ADDRESSES = 20;

export interface CreateAddressInput {
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  receiver?: string;
  phone?: string;
  region?: string;
  detail?: string;
  isDefault?: boolean;
}

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  /** 地址列表：默认地址排最前，其余按创建时间正序 */
  async listMine(userId: string) {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      items: addresses.map((a) => ({
        id: a.id,
        receiver: a.receiver,
        phone: a.phone,
        region: a.region,
        detail: a.detail,
        isDefault: a.isDefault,
      })),
    };
  }

  async create(userId: string, input: CreateAddressInput) {
    const receiver = this.requireText(input.receiver, '收货人');
    const phone = this.requirePhone(input.phone);
    const region = this.requireText(input.region, '所在地区');
    const detail = this.requireText(input.detail, '详细地址');

    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) {
      throw new BadRequestException(`最多保存 ${MAX_ADDRESSES} 个收货地址`);
    }

    // 首条地址自动设为默认；显式指定默认时同样只保留一个默认地址
    const makeDefault = input.isDefault === true || count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: { userId, receiver, phone, region, detail, isDefault: makeDefault },
      });
    });
  }

  async update(userId: string, id: string, input: UpdateAddressInput) {
    const existing = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('地址不存在');

    const receiver = this.optionalText(input.receiver, '收货人');
    const phone = input.phone === undefined ? undefined : this.requirePhone(input.phone);
    const region = this.optionalText(input.region, '所在地区');
    const detail = this.optionalText(input.detail, '详细地址');

    const data = {
      ...(receiver !== undefined ? { receiver } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(detail !== undefined ? { detail } : {}),
    };

    if (input.isDefault === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
        return tx.address.update({ where: { id }, data: { ...data, isDefault: true } });
      });
    }

    return this.prisma.address.update({
      where: { id },
      data: { ...data, ...(input.isDefault === false ? { isDefault: false } : {}) },
    });
  }

  /** 删除后若默认地址被移除，把最早创建的地址补位为默认 */
  async remove(userId: string, id: string) {
    const existing = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('地址不存在');

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (!existing.isDefault) return;

      const oldest = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      if (oldest) {
        await tx.address.update({ where: { id: oldest.id }, data: { isDefault: true } });
      }
    });

    return { deleted: true };
  }

  async setDefault(userId: string, id: string) {
    const existing = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('地址不存在');

    await this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.address.update({ where: { id }, data: { isDefault: true } });
    });

    return { id, isDefault: true };
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

  private requirePhone(value: string | undefined): string {
    const phone = value?.trim() ?? '';
    if (!PHONE_PATTERN.test(phone)) throw new BadRequestException('手机号格式不正确');
    return phone;
  }
}
