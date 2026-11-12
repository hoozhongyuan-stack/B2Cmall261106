import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

import { CustomerService } from './customer.service';
import { UserTagService } from './user-tag.service';
import { LoyaltyService } from '../member/loyalty.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class AdjustPointsDto {
  @IsInt()
  delta!: number;

  @IsString()
  reason!: string;
}

class BatchTagsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  userIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsIn(['add', 'remove', 'replace'])
  mode?: 'add' | 'remove' | 'replace';
}

@ApiTags('admin-customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/customers')
export class AdminCustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly loyalty: LoyaltyService,
    private readonly userTags: UserTagService,
  ) {}

  @Get()
  @Permission('customer.view')
  @ApiOperation({ summary: '客户列表：消费统计与等级（分页，可按标签 / 时间 / 消费区间筛选）' })
  list(
    @Query('keyword') keyword?: string,
    @Query('levelId') levelId?: string,
    @Query('tagId') tagId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('minSpentCents') minSpentCents?: string,
    @Query('maxSpentCents') maxSpentCents?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.customers.list({
      keyword,
      levelId,
      tagId,
      startDate,
      endDate,
      minSpentCents: minSpentCents === undefined ? undefined : Number(minSpentCents),
      maxSpentCents: maxSpentCents === undefined ? undefined : Number(maxSpentCents),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('batch/tags')
  @HttpCode(200)
  @Permission('customer.edit')
  @ApiOperation({ summary: '批量打标签：add 追加 / remove 移除 / replace 覆盖' })
  batchTags(@Body() dto: BatchTagsDto) {
    return this.userTags.assign(dto);
  }

  @Get(':id')
  @Permission('customer.view')
  @ApiOperation({ summary: '客户详情：资产、最近订单与积分流水' })
  detail(@Param('id') id: string) {
    return this.customers.detail(id);
  }

  @Post(':id/points')
  @HttpCode(200)
  @Permission('customer.edit')
  @ApiOperation({ summary: '手动发放 / 扣减积分（记入流水）' })
  adjustPoints(@Param('id') id: string, @Body() dto: AdjustPointsDto) {
    return this.loyalty.adjustPoints(id, dto.delta, dto.reason);
  }
}
