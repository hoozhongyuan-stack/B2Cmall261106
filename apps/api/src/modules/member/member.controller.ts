import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { LoyaltyService } from './loyalty.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class LevelDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  thresholdCents!: number;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  discountRate!: number;
}

class UpdateLevelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdCents?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  discountRate?: number;
}

@ApiTags('member')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('member')
export class MemberController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('profile')
  @ApiOperation({ summary: '会员中心：等级、成长值、积分与券数量' })
  profile(@CurrentUser() user: MiniappUser) {
    return this.loyalty.profile(user.sub);
  }

  @Get('points')
  @ApiOperation({ summary: '积分明细（仅记录发放与扣回，不参与抵扣）' })
  points(@CurrentUser() user: MiniappUser) {
    return this.loyalty.ledger(user.sub);
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/member-levels')
export class AdminMemberLevelController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @Permission('level.view')
  @ApiOperation({ summary: '等级规则列表（含各等级人数）' })
  list() {
    return this.loyalty.listLevels();
  }

  @Post()
  @Permission('level.manage')
  @ApiOperation({ summary: '新建等级规则' })
  create(@Body() dto: LevelDto) {
    return this.loyalty.createLevel(dto);
  }

  @Patch(':id')
  @Permission('level.manage')
  @ApiOperation({ summary: '修改等级门槛或折扣' })
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.loyalty.updateLevel(id, dto);
  }
}
