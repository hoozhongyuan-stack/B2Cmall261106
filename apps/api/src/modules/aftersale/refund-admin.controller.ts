import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';
import { RefundReconcileService } from './refund-reconcile.service';

@ApiTags('admin-refunds')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/refunds')
export class AdminRefundController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: RefundReconcileService,
  ) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '退款单列表：按状态/渠道状态筛选，用于对账' })
  async list(
    @Query('status') status?: string,
    @Query('channelStatus') channelStatus?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const currentPage = Math.max(Number(page) || 1, 1);
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const where = {
      ...(status ? { status: status as never } : {}),
      ...(channelStatus ? { channelStatus } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { afterSale: { include: { order: true } } },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      total,
      page: currentPage,
      pageSize: size,
      items: items.map((refund) => ({
        id: refund.id,
        refundNo: refund.refundNo,
        orderNo: refund.afterSale.order.orderNo,
        afterSaleNo: refund.afterSale.afterSaleNo,
        amountCents: refund.amountCents,
        status: refund.status,
        provider: refund.provider,
        channelStatus: refund.channelStatus,
        transactionId: refund.transactionId,
        failReason: refund.failReason,
        lastQueriedAt: refund.lastQueriedAt,
        createdAt: refund.createdAt,
      })),
    };
  }

  @Post(':id/query')
  @HttpCode(200)
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '立即查询微信退款状态并同步' })
  query(@Param('id') id: string) {
    return this.reconcile.queryOne(id);
  }
}
