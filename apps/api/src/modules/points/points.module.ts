import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PointsService } from './points.service';
import { AdminPointsConfigController, PointsController } from './points.controller';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';
import { UserJwtGuard } from '../../common/user-auth.guard';

/** 积分体系：消费 / 签到 / 分享的规则与发放；不做积分抵扣 */
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
  controllers: [PointsController, AdminPointsConfigController],
  providers: [PointsService, JwtAuthGuard, RolesGuard, UserJwtGuard],
})
export class PointsModule {}
