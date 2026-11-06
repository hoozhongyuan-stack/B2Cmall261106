import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './modules/auth/auth.module';
import { CatalogController } from './modules/catalog/catalog.controller';
import { ProductDetailController } from './modules/catalog/product-detail.controller';
import { TradeModule } from './modules/trade.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // 同时兼容从仓库根目录（测试、CI）与 apps/api（本地 dev）启动
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'apps/api/.env'] }),
    PrismaModule,
    AuthModule,
    TradeModule,
  ],
  controllers: [CatalogController, ProductDetailController],
})
export class AppModule {}
