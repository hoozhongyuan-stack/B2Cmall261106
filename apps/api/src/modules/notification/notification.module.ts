import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminNotificationController } from './notification.controller';
import { SubscriptionController } from './subscribe.controller';
import { NotificationService } from './notification.service';
import { IntegrationModule } from '../integration/integration.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 订阅消息：outbox 日志、异步发送与重试、后台查询 */
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
  controllers: [AdminNotificationController, SubscriptionController],
  providers: [NotificationService, JwtAuthGuard, RolesGuard],
  exports: [NotificationService],
})
export class NotificationModule {}
