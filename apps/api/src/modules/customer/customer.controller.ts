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
import { IsInt, IsString } from 'class-validator';

import { CustomerService } from './customer.service';
import { LoyaltyService } from '../member/loyalty.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class AdjustPointsDto {
  @IsInt()
  delta!: number;

  @IsString()
  reason!: string;
}

@ApiTags('admin-customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/customers')
export class AdminCustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '客户列表：消费统计与等级' })
  list(@Query('keyword') keyword?: string, @Query('levelId') levelId?: string) {
    return this.customers.list({ keyword, levelId });
  }

  @Get(':id')
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '客户详情：资产、最近订单与积分流水' })
  detail(@Param('id') id: string) {
    return this.customers.detail(id);
  }

  @Post(':id/points')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '手动发放 / 扣减积分（记入流水）' })
  adjustPoints(@Param('id') id: string, @Body() dto: AdjustPointsDto) {
    return this.loyalty.adjustPoints(id, dto.delta, dto.reason);
  }
}
