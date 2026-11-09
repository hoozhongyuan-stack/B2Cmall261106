import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { DeliveryModule } from '../delivery/delivery.module';
import { PickupModule } from '../pickup/pickup.module';
import { StoreModule } from '../store/store.module';
import { UserJwtGuard } from '../../common/user-auth.guard';
import { StoreConsoleController } from './store-console.controller';
import { StoreConsoleService } from './store-console.service';

/**
 * 门店小程序工作台：门店负责人用小程序 JWT 访问，数据范围由 Store.managerUserId 决定。
 */
@Module({
  imports: [
    PickupModule,
    DeliveryModule,
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
  controllers: [StoreConsoleController],
  providers: [StoreConsoleService, UserJwtGuard],
})
export class StoreConsoleModule {}
