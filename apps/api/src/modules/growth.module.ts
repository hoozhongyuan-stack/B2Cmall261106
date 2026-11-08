import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminCouponController, CouponController } from './coupon/coupon.controller';
import { CouponService } from './coupon/coupon.service';
import { AdminMemberLevelController, MemberController } from './member/member.controller';
import { LoyaltyService } from './member/loyalty.service';
import { AdminCustomerController } from './customer/customer.controller';
import { CustomerService } from './customer/customer.service';
import {
  AdminReviewController,
  ProductReviewController,
  ReviewController,
} from './review/review.controller';
import { ReviewService } from './review/review.service';
import { AssetModule } from './assets/asset.module';
import { JwtAuthGuard, RolesGuard } from '../common/auth.guards';
import { UserJwtGuard } from '../common/user-auth.guard';

/**
 * 客户资产与复购能力：优惠券、会员等级、积分流水、客户视图、评价。
 * 导出 CouponService / LoyaltyService 供交易链路复用（订单取消退券、支付发放积分、退款扣回）。
 */
@Module({
  imports: [
    AssetModule,
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
    CouponController,
    AdminCouponController,
    MemberController,
    AdminMemberLevelController,
    AdminCustomerController,
    ReviewController,
    ProductReviewController,
    AdminReviewController,
  ],
  providers: [
    CouponService,
    LoyaltyService,
    CustomerService,
    ReviewService,
    UserJwtGuard,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [CouponService, LoyaltyService],
})
export class GrowthModule {}
