import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminPopupAdController, PopupAdController } from './popup-ad.controller';
import { PopupAdService } from './popup-ad.service';
import { AssetModule } from '../assets/asset.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 首页弹窗广告：后台配置 + 小程序下发 */
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
  controllers: [PopupAdController, AdminPopupAdController],
  providers: [PopupAdService, JwtAuthGuard, RolesGuard],
})
export class PopupAdModule {}
