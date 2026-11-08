import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminPromotionController, PromotionPublicController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 营销活动：满减与限时秒杀 */
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
  controllers: [PromotionPublicController, AdminPromotionController],
  providers: [PromotionService, JwtAuthGuard, RolesGuard],
  exports: [PromotionService],
})
export class PromotionModule {}
