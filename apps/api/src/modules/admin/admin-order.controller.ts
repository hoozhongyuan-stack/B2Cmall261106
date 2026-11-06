import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { can, nextStatus } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class ShipDto {
  @IsString()
  expressCode!: string;

  @IsString()
  expressName!: string;

  @IsString()
  trackingNo!: string;
}

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '订单列表：按状态筛选与关键词搜索' })
  async list(@Query('status') status?: string, @Query('keyword') keyword?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(keyword
          ? {
              OR: [
                { orderNo: { contains: keyword, mode: 'insensitive' } },
                { user: { nickname: { contains: keyword, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true, user: true },
      take: 50,
    });

    const counts = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return {
      tabs: counts.map((c) => ({ status: c.status, count: c._count._all })),
      items: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        payableCents: o.payableCents,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        customer: { nickname: o.user.nickname, phone: o.user.phone },
        itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
        firstItemTitle: o.items[0]?.title ?? '',
        address: o.addressSnapshot,
      })),
    };
  }

  @Get(':id')
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '订单详情（后台视图）' })
  async detail(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, shipment: true, payments: true, user: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  @Post(':id/ship')
  @HttpCode(200)
  @Roles('SUPER', 'WMS')
  @ApiOperation({ summary: '发货：写入物流信息并把订单推进到待收货' })
  async ship(@Param('id') id: string, @Body() dto: ShipDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 用共享状态机校验，避免后台绕过规则
    if (!can(order.status as never, 'ship')) {
      throw new ConflictException('订单状态已变化，请刷新');
    }
    const next = nextStatus(order.status as never, 'ship');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, version: order.version, status: order.status },
        data: { status: next as never, version: { increment: 1 }, shippedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

      await tx.shipment.upsert({
        where: { orderId: id },
        update: {
          expressCode: dto.expressCode,
          expressName: dto.expressName,
          trackingNo: dto.trackingNo,
        },
        create: {
          orderId: id,
          expressCode: dto.expressCode,
          expressName: dto.expressName,
          trackingNo: dto.trackingNo,
        },
      });
    });

    return { id, status: next, trackingNo: dto.trackingNo };
  }

  @Post(':id/remark')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '添加商家备注（仅后台可见）' })
  async remark(@Param('id') id: string, @Body() body: { remark: string }) {
    await this.prisma.order.update({ where: { id }, data: { adminRemark: body.remark } });
    return { id };
  }
}
