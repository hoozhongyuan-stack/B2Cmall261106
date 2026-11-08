import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { IntegrationModule } from '../integration/integration.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 系统状态与本地告警（磁盘、备份、退款、通知） */
@Module({
  imports: [
    IntegrationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [OpsController],
  providers: [OpsService, JwtAuthGuard, RolesGuard],
})
export class OpsModule {}
