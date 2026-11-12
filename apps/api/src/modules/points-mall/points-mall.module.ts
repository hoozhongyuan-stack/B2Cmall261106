import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  AdminPointsMallController,
  MemberPointsMallController,
  PointsMallController,
} from './points-mall.controller';
import { PointsMallService } from './points-mall.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';
import { UserJwtGuard } from '../../common/user-auth.guard';
import { IntegrationModule } from '../integration/integration.module';
import { TradeModule } from '../trade.module';

/** 积分商城：商品浏览、兑换下单、限兑与整单退款 */
@Module({
  imports: [
    IntegrationModule,
    TradeModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [PointsMallController, MemberPointsMallController, AdminPointsMallController],
  providers: [PointsMallService, JwtAuthGuard, RolesGuard, UserJwtGuard],
})
export class PointsMallModule {}
