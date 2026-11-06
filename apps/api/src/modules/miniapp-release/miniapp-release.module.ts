import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminMiniappReleaseController } from './miniapp-release.controller';
import { MiniappReleaseService } from './miniapp-release.service';
import { IntegrationModule } from '../integration/integration.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

@Module({
  imports: [
    IntegrationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AdminMiniappReleaseController],
  providers: [MiniappReleaseService, JwtAuthGuard, RolesGuard],
})
export class MiniappReleaseModule {}
