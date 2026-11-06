import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './modules/auth/auth.module';
import { CatalogController } from './modules/catalog/catalog.controller';
import { ProductDetailController } from './modules/catalog/product-detail.controller';
import { TradeModule } from './modules/trade.module';
import { CatalogAdminModule } from './modules/catalog-admin.module';
import { AdminOpsModule } from './modules/admin/admin-ops.module';
import { PrismaModule } from './prisma/prisma.module';
import { AdminAuditInterceptor } from './common/admin-audit.interceptor';
import { RateLimitGuard } from './common/rate-limit.guard';
import { TelemetryModule } from './modules/telemetry/telemetry.module';

@Module({
  imports: [
    // 同时兼容从仓库根目录（测试、CI）与 apps/api（本地 dev）启动
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'apps/api/.env'] }),
    PrismaModule,
    AuthModule,
    TradeModule,
    CatalogAdminModule,
    AdminOpsModule,
    TelemetryModule,
  ],
  controllers: [CatalogController, ProductDetailController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
    // 仅对标注了 @RateLimit 的接口生效
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
