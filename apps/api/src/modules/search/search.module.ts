import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { SearchAdminController } from './search-admin.controller';
import { SearchPublicController } from './search-public.controller';
import { SearchLogService } from './search-log.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 搜索日志：热词 / 无结果词统计 */
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
  controllers: [SearchPublicController, SearchAdminController],
  providers: [SearchLogService, JwtAuthGuard, RolesGuard],
  exports: [SearchLogService],
})
export class SearchModule {}
