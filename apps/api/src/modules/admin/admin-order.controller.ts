import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { can, nextStatus } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthUser,
} from '../../common/auth.guards';
import { NotificationService } from '../notification/notification.service';
import { ExpressService } from '../express/express.service';
import { StoreScopeService } from '../store/store-scope.service';

class ShipDto {
  @IsString()
  expressCode!: string;

  @IsString()
  expressName!: string;

  @IsString()
  trackingNo!: string;
}

class BatchShipItemDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsString()
  expressCode?: string;

  @IsString()
  trackingNo!: string;
}

class BatchShipDto {
  /** 默认物流公司；条目可单独覆盖 */
  @IsOptional()
  @IsString()
  expressCode?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BatchShipItemDto)
  items!: BatchShipItemDto[];
}

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/orders')
export class AdminOrderController {
  private readonly logger = new Logger(AdminOrderController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly express: ExpressService,
    private readonly storeScope: StoreScopeService,
  ) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS', 'STORE')
  @ApiOperation({ summary: '订单列表：状态 / 门店 / 履约方式筛选与关键词搜索' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('storeId') storeId?: string,
    @Query('fulfillmentType') fulfillmentType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (
      fulfillmentType &&
      !['EXPRESS', 'DELIVERY', 'PICKUP'].includes(fulfillmentType)
    ) {
      throw new BadRequestException('履约方式不合法');
    }

    const currentPage = Math.max(Number(page) || 1, 1);
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const scope = await this.storeScope.resolve(user);
    if (storeId && !scope.all && !scope.storeIds.includes(storeId)) {
      throw new NotFoundException('门店不存在');
    }
    const scopeWhere = storeId
      ? { storeId }
      : scope.all
        ? {}
        : { storeId: { in: scope.storeIds } };
    const where = {
      ...scopeWhere,
      ...(status ? { status: status as never } : {}),
      ...(fulfillmentType ? { fulfillmentType } : {}),
      ...(keyword
        ? {
            OR: [
              { orderNo: { contains: keyword, mode: 'insensitive' as const } },
              { user: { nickname: { contains: keyword, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [orders, total, counts] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { items: true, user: true, store: { select: { name: true } } },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ['status'], where: scopeWhere, _count: { _all: true } }),
    ]);

    return {
      tabs: counts.map((c) => ({ status: c.status, count: c._count._all })),
      total,
      page: currentPage,
      pageSize: size,
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
        fulfillmentType: o.fulfillmentType,
        storeId: o.storeId,
        storeName: o.store?.name ?? null,
      })),
    };
  }

  @Get(':id')
  @Roles('SUPER', 'OPS', 'CS', 'WMS', 'STORE')
  @ApiOperation({ summary: '订单详情（后台视图，门店账号仅授权门店）' })
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const scope = await this.storeScope.resolve(user);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        shipment: true,
        payments: true,
        user: true,
        pickupVerification: true,
        store: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (!scope.all && (!order.storeId || !scope.storeIds.includes(order.storeId))) {
      throw new NotFoundException('订单不存在');
    }
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
    if (order.fulfillmentType !== 'EXPRESS') {
      throw new ConflictException('非快递订单请在履约页操作');
    }

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

    try {
      await this.notifications.enqueueOrderShipped(id);
    } catch (err) {
      this.logger.warn(`发货通知入队失败 order=${id}`, err as Error);
    }

    return { id, status: next, trackingNo: dto.trackingNo };
  }

  @Post('batch-ship')
  @HttpCode(200)
  @Roles('SUPER', 'WMS')
  @ApiOperation({ summary: '批量发货：逐单事务，返回成功/失败明细（最多 200 单）' })
  async batchShip(@Body() dto: BatchShipDto) {
    if (!dto.items.length) throw new ConflictException('请提供发货明细');
    if (dto.items.length > 200) throw new ConflictException('单次最多发货 200 单');

    const results: Array<{
      orderId: string;
      orderNo: string;
      ok: boolean;
      trackingNo?: string;
      expressName?: string;
      reason?: string;
    }> = [];

    for (const item of dto.items) {
      try {
        const order = item.orderId
          ? await this.prisma.order.findUnique({ where: { id: item.orderId } })
          : item.orderNo
            ? await this.prisma.order.findUnique({ where: { orderNo: item.orderNo } })
            : null;
        if (!order) throw new NotFoundException('订单不存在');
        if (order.fulfillmentType !== 'EXPRESS') {
          throw new ConflictException('非快递订单请在履约页操作');
        }

        const company = await this.express.resolve(item.expressCode ?? dto.expressCode);
        if (!can(order.status as never, 'ship')) {
          throw new ConflictException('订单状态不是待发货');
        }
        const next = nextStatus(order.status as never, 'ship');

        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: order.id, version: order.version, status: order.status },
            data: { status: next as never, version: { increment: 1 }, shippedAt: new Date() },
          });
          if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

          await tx.shipment.upsert({
            where: { orderId: order.id },
            update: {
              expressCode: company.code,
              expressName: company.name,
              trackingNo: item.trackingNo.trim(),
            },
            create: {
              orderId: order.id,
              expressCode: company.code,
              expressName: company.name,
              trackingNo: item.trackingNo.trim(),
            },
          });
        });

        try {
          await this.notifications.enqueueOrderShipped(order.id);
        } catch (err) {
          this.logger.warn(`批量发货通知入队失败 order=${order.id}`, err as Error);
        }

        results.push({
          orderId: order.id,
          orderNo: order.orderNo,
          ok: true,
          trackingNo: item.trackingNo.trim(),
          expressName: company.name,
        });
      } catch (err) {
        results.push({
          orderId: item.orderId ?? '',
          orderNo: item.orderNo ?? '',
          ok: false,
          reason: err instanceof Error ? err.message : '发货失败',
        });
      }
    }

    const success = results.filter((result) => result.ok).length;
    return { total: results.length, success, failed: results.length - success, results };
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
