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
import { IsOptional, IsString, Length } from 'class-validator';

import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthUser,
} from '../../common/auth.guards';
import { DeliveryService } from './delivery.service';

class AcceptDeliveryDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  courierName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  courierPhone?: string;
}

class CancelDeliveryDto {
  @IsString()
  @Length(1, 200)
  reason!: string;
}

const ALL_ROLES = ['SUPER', 'OPS', 'CS', 'WMS', 'STORE'] as const;

@ApiTags('admin-deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/deliveries')
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '同城配送单列表：状态/门店/日期筛选' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
    @Query('date') date?: string,
  ) {
    return this.deliveries.list(user, { status, storeId, date });
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '接单：可带配送员姓名/电话，订单推进到待收货' })
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AcceptDeliveryDto,
  ) {
    return this.deliveries.accept(user, id, dto);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '送达：订单推进到已完成' })
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deliveries.deliver(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '取消配送：仅待接单/配送中，需填写原因' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelDeliveryDto,
  ) {
    return this.deliveries.cancel(user, id, dto.reason);
  }
}
