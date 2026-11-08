import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminHomeController, HomeController } from './home.controller';
import { HomeService } from './home.service';
import { AssetModule } from '../assets/asset.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 首页运营位：轮播 / 金刚区 / 推荐位 */
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
  controllers: [HomeController, AdminHomeController],
  providers: [HomeService, JwtAuthGuard, RolesGuard],
  exports: [HomeService],
})
export class HomeModule {}
