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
import { AdminRefundController } from './aftersale/refund-admin.controller';
import { RefundReconcileService } from './aftersale/refund-reconcile.service';
import {
  AdminCardPlanController,
  AdminMemberCardController,
  AdminRechargeOrderController,
  AdminRechargePlanController,
  AdminStoredValueController,
  MemberCardController,
  MemberCardPublicController,
  OrderBalancePayController,
  StoredValueController,
} from './member/member-commerce.controller';
import { MemberCommerceService } from './member/member-commerce.service';
import { OrderTimeoutService } from './order/order-timeout.service';
import { AdminOrderOpsController, ShipmentController } from './order/shipment.controller';
import { JwtAuthGuard, RolesGuard } from '../common/auth.guards';
import { UserJwtGuard } from '../common/user-auth.guard';
import { GrowthModule } from './growth.module';
import { AddressController } from './address/address.controller';
import { AddressService } from './address/address.service';
import { IntegrationModule } from './integration/integration.module';
import { NotificationModule } from './notification/notification.module';
import { ExpressModule } from './express/express.module';
import { PromotionModule } from './promotion/promotion.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    GrowthModule,
    IntegrationModule,
    NotificationModule,
    ExpressModule,
    PromotionModule,
    StoreModule,
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
    AdminRefundController,
    MemberCardPublicController,
    MemberCardController,
    StoredValueController,
    OrderBalancePayController,
    AdminCardPlanController,
    AdminMemberCardController,
    AdminRechargePlanController,
    AdminStoredValueController,
    AdminRechargeOrderController,
    ShipmentController,
    AdminOrderOpsController,
    AddressController,
  ],
  providers: [
    CartService,
    OrderService,
    PaymentService,
    AfterSaleService,
    RefundReconcileService,
    MemberCommerceService,
    OrderTimeoutService,
    AddressService,
    UserJwtGuard,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [OrderService],
})
export class TradeModule {}
