import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';
import { OrderController } from './order/order.controller';
import { OrderService } from './order/order.service';
import { PaymentController, OrderPayController } from './payment/payment.controller';
import { PaymentService } from './payment/payment.service';
import { AdminOrderController } from './admin/admin-order.controller';
import { AfterSaleController, AdminAfterSaleController } from './aftersale/aftersale.controller';
import { AfterSaleService } from './aftersale/aftersale.service';
import { OrderTimeoutService } from './order/order-timeout.service';
import { AdminOrderOpsController, ShipmentController } from './order/shipment.controller';
import { JwtAuthGuard, RolesGuard } from '../common/auth.guards';
import { UserJwtGuard } from '../common/user-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    CartController,
    OrderController,
    OrderPayController,
    PaymentController,
    AdminOrderController,
    AfterSaleController,
    AdminAfterSaleController,
    ShipmentController,
    AdminOrderOpsController,
  ],
  providers: [
    CartService,
    OrderService,
    PaymentService,
    AfterSaleService,
    OrderTimeoutService,
    UserJwtGuard,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [OrderService],
})
export class TradeModule {}
