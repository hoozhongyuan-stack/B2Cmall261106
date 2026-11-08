import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';
import { AdminOpsModule } from '../admin/admin-ops.module';
import { NotificationModule } from '../notification/notification.module';
import { StoreModule } from '../store/store.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [
    StoreModule,
    AdminOpsModule,
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService, JwtAuthGuard, RolesGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
