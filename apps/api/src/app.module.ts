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
import { OptionalUserJwtGuard } from './common/user-auth.guard';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { MiniappReleaseModule } from './modules/miniapp-release/miniapp-release.module';
import { OpsModule } from './modules/ops/ops.module';
import { MicroPageModule } from './modules/micro-page/micro-page.module';
import { PopupAdModule } from './modules/popup-ad/popup-ad.module';
import { PointsModule } from './modules/points/points.module';
import { PointsMallModule } from './modules/points-mall/points-mall.module';
import { ExpressModule } from './modules/express/express.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { StoreModule } from './modules/store/store.module';
import { PickupModule } from './modules/pickup/pickup.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { SearchModule } from './modules/search/search.module';
import { StoreConsoleModule } from './modules/store-console/store-console.module';

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
    IntegrationModule,
    MiniappReleaseModule,
    OpsModule,
    MicroPageModule,
    PopupAdModule,
    PointsModule,
    PointsMallModule,
    ExpressModule,
    AnalyticsModule,
    StoreModule,
    PickupModule,
    DeliveryModule,
    SearchModule,
    StoreConsoleModule,
  ],
  controllers: [CatalogController, ProductDetailController],
  providers: [
    OptionalUserJwtGuard,
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
    // 仅对标注了 @RateLimit 的接口生效
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
