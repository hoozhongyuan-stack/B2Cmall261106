import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentUser, JwtAuthGuard, RolesGuard, type AuthUser, Permission } from '../../common/auth.guards';
import { RateLimit } from '../../common/rate-limit.guard';
import { PickupService } from './pickup.service';

class VerifyPickupDto {
  @IsString()
  @MinLength(8)
  @MaxLength(8)
  code!: string;
}


@ApiTags('admin-pickups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/pickups')
export class PickupController {
  constructor(private readonly pickups: PickupService) {}

  @Get()
  @Permission('pickup.verify')
  @ApiOperation({ summary: '自提待核销 / 核销记录（分页）' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
    @Query('storeIds') storeIds?: string,
    @Query('keyword') keyword?: string,
    @Query('date') date?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pickups.list(user, {
      status,
      storeId,
      storeIds,
      keyword,
      date,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('verify')
  @HttpCode(200)
  @Permission('pickup.verify')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: '核销自提码；重复核销返回已核销信息' })
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyPickupDto) {
    return this.pickups.verify(user, dto.code);
  }
}
