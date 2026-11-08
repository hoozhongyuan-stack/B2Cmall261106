import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  AdminExpressCompanyController,
  ExpressCompanyController,
} from './express.controller';
import { ExpressService } from './express.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';

/** 物流公司字典：发货与批量发货共用 */
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
  controllers: [ExpressCompanyController, AdminExpressCompanyController],
  providers: [ExpressService, JwtAuthGuard, RolesGuard],
  exports: [ExpressService],
})
export class ExpressModule {}
