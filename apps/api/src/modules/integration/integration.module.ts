import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminIntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

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
  controllers: [AdminIntegrationController],
  providers: [IntegrationService, JwtAuthGuard, RolesGuard],
  exports: [IntegrationService],
})
export class IntegrationModule {}
