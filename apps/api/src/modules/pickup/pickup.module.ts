import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';
import { AdminOpsModule } from '../admin/admin-ops.module';
import { NotificationModule } from '../notification/notification.module';
import { StoreModule } from '../store/store.module';
import { PickupController } from './pickup.controller';
import { PickupTimeoutService } from './pickup-timeout.service';
import { PickupService } from './pickup.service';

@Module({
  imports: [
    StoreModule,
    NotificationModule,
    AdminOpsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [PickupController],
  providers: [PickupService, PickupTimeoutService, JwtAuthGuard, RolesGuard],
  exports: [PickupService],
})
export class PickupModule {}
