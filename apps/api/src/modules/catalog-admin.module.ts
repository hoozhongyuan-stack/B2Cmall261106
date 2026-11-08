import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminProductController } from './admin/admin-product.controller';
import { AdminProductService } from './admin/admin-product.service';
import { AdminCategoryController, AdminTagController } from './admin/admin-category.controller';
import { AdminTaxonomyService } from './admin/admin-taxonomy.service';
import { AdminShopController } from './shop/shop-admin.controller';
import { ShopService } from './shop/shop.service';
import { AdminAssetController } from './assets/asset.controller';
import { AssetModule } from './assets/asset.module';
import { JwtAuthGuard, RolesGuard } from '../common/auth.guards';

/**
 * 商品 / 分类 / 标签 / 店铺设置 / 素材的后台管理能力。
 * 单商家自营场景，仅后台角色访问，无小程序侧接口。
 */
@Module({
  imports: [
    AssetModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    AdminProductController,
    AdminCategoryController,
    AdminTagController,
    AdminShopController,
    AdminAssetController,
  ],
  providers: [
    AdminProductService,
    AdminTaxonomyService,
    ShopService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class CatalogAdminModule {}
