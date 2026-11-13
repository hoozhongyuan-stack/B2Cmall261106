import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AdminCircleController } from './circle.controller';
import { CircleMemberController } from './circle-member.controller';
import { CircleService } from './circle.service';
import { CirclePostService } from './circle-post.service';
import { CircleContentSecurityService } from './circle-content-security.service';
import { AssetModule } from '../assets/asset.module';
import { IntegrationModule } from '../integration/integration.module';
import { JwtAuthGuard, RolesGuard } from '../../common/auth.guards';
import { UserJwtGuard } from '../../common/user-auth.guard';

/** 圈子（品牌内容社区）：类目、话题、设置、会员发帖与内容审核 */
@Module({
  imports: [
    AssetModule,
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
  controllers: [AdminCircleController, CircleMemberController],
  providers: [
    CircleService,
    CirclePostService,
    CircleContentSecurityService,
    JwtAuthGuard,
    RolesGuard,
    UserJwtGuard,
  ],
})
export class CircleModule {}
