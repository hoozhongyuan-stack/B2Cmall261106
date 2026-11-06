import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';
import { AdminLogController } from './admin-log.controller';
import { OperationLogService } from './operation-log.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/**
 * 后台运营支撑：子账号管理、操作日志查询、数据概览。
 * PrismaModule 为 @Global，无需重复引入。
 */
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
  controllers: [AdminAccountController, AdminLogController, AdminDashboardController],
  providers: [
    AdminAccountService,
    OperationLogService,
    AdminDashboardService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [OperationLogService],
})
export class AdminOpsModule {}
