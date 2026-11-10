import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  AdminLinkOptionsController,
  AdminMicroPageController,
  AdminTabbarController,
  MicroPageController,
} from './micro-page.controller';
import { MicroPageService } from './micro-page.service';
import { AssetModule } from '../assets/asset.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 微页面装修：页面 CRUD / 发布快照 / 底部导航 / 老首页迁移 */
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
    MicroPageController,
    AdminMicroPageController,
    AdminLinkOptionsController,
    AdminTabbarController,
  ],
  providers: [MicroPageService, JwtAuthGuard, RolesGuard],
  exports: [MicroPageService],
})
export class MicroPageModule {}
