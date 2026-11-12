import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';
import { OrderTimeoutService } from '../order/order-timeout.service';

interface TraceNode {
  time: Date;
  title: string;
  desc: string;
}

@ApiTags('shipment')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('orders')
export class ShipmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/shipment')
  @ApiOperation({ summary: '物流详情（节点时间线）' })
  async shipment(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId: user.sub },
      include: { shipment: true, items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');

    if (!order.shipment) {
      return {
        shipped: false,
        expressName: null,
        expressCode: null,
        trackingNo: null,
        // 尚未发货：只返回已发生的订单节点
        nodes: order.paidAt
          ? [{ time: order.paidAt, title: '订单已支付', desc: '等待商家发货' }]
          : [],
        traceSource: 'INTERNAL',
      };
    }

    const nodes: TraceNode[] = [];
    if (order.shippedAt) {
      nodes.push({
        time: order.shippedAt,
        title: '商家已发货',
        desc: `包裹已交给${order.shipment.expressName}`,
      });
    }
    if (order.paidAt) {
      nodes.push({ time: order.paidAt, title: '订单已支付', desc: '等待商家发货' });
    }
    if (order.completedAt) {
      nodes.unshift({ time: order.completedAt, title: '已确认收货', desc: '交易完成' });
    }
    nodes.sort((a, b) => b.time.getTime() - a.time.getTime());

    return {
      shipped: true,
      expressName: order.shipment.expressName,
      expressCode: order.shipment.expressCode,
      trackingNo: order.shipment.trackingNo,
      nodes,
      // INTERNAL 表示节点来自站内事件；接入快递查询后改为 courier
      traceSource: 'INTERNAL',
    };
  }
}

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/orders')
export class AdminOrderOpsController {
  constructor(private readonly timeout: OrderTimeoutService) {}

  @Post('close-expired')
  @Permission('order.edit')
  @ApiOperation({ summary: '手动触发超时关单（运维用，定时任务每分钟自动执行）' })
  closeExpired() {
    return this.timeout.closeExpired();
  }
}
