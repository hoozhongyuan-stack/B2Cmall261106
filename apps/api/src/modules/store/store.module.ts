import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { StoreController } from './store.controller';
import { StoreAdminController } from './store-admin.controller';
import { StoreStockController } from './store-stock.controller';
import { StoreService } from './store.service';
import { StoreScopeService } from './store-scope.service';
import { StoreStockService } from './store-stock.service';
import { StoreInventoryService } from './store-inventory.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 轻量多门店：门店配置、门店数据范围与后续库存/看板能力的归属模块 */
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
  controllers: [StoreController, StoreAdminController, StoreStockController],
  providers: [
    StoreService,
    StoreScopeService,
    StoreStockService,
    StoreInventoryService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [StoreService, StoreScopeService, StoreStockService, StoreInventoryService],
})
export class StoreModule {}
