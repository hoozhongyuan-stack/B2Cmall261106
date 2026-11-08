import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

export interface ExpressCompanyInput {
  code?: string;
  name?: string;
  sort?: number;
  enabled?: boolean;
}

@Injectable()
export class ExpressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeDisabled = false) {
    const items = await this.prisma.expressCompany.findMany({
      where: includeDisabled ? {} : { enabled: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return { items };
  }

  async create(input: ExpressCompanyInput) {
    const code = this.code(input.code);
    const name = this.name(input.name);
    try {
      return await this.prisma.expressCompany.create({
        data: { code, name, sort: this.sort(input.sort), enabled: input.enabled ?? true },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('物流公司编码已存在');
      }
      throw err;
    }
  }

  async update(id: string, input: ExpressCompanyInput) {
    const current = await this.prisma.expressCompany.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('物流公司不存在');

    try {
      return await this.prisma.expressCompany.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: this.code(input.code) } : {}),
          ...(input.name !== undefined ? { name: this.name(input.name) } : {}),
          ...(input.sort !== undefined ? { sort: this.sort(input.sort) } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('物流公司编码已存在');
      }
      throw err;
    }
  }

  async remove(id: string) {
    const current = await this.prisma.expressCompany.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('物流公司不存在');
    await this.prisma.expressCompany.delete({ where: { id } });
    return { deleted: true };
  }

  /** 发货前解析物流公司：编码必须在字典内且启用 */
  async resolve(codeInput: string | undefined): Promise<{ code: string; name: string }> {
    const code = this.code(codeInput);
    const company = await this.prisma.expressCompany.findUnique({ where: { code } });
    if (!company || !company.enabled) {
      throw new BadRequestException(`未知或已停用的物流公司：${code}`);
    }
    return { code: company.code, name: company.name };
  }

  private code(value?: string): string {
    const code = (value ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
      throw new BadRequestException('物流公司编码需为 2-20 位大写字母、数字、下划线或连字符');
    }
    return code;
  }

  private name(value?: string): string {
    const name = (value ?? '').trim();
    if (!name) throw new BadRequestException('物流公司名称不能为空');
    if (name.length > 20) throw new BadRequestException('物流公司名称不能超过 20 个字符');
    return name;
  }

  private sort(value?: number): number {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException('排序必须为非负整数');
    }
    return value;
  }
}
