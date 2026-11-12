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
import { ArrayMinSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

import { CurrentUser, JwtAuthGuard, RolesGuard, type AuthUser, Permission } from '../../common/auth.guards';
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

class BatchAcceptDto extends AcceptDeliveryDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}


@ApiTags('admin-deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/deliveries')
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  @Permission('delivery.manage')
  @ApiOperation({ summary: '同城配送单列表：状态/门店/日期筛选，分页' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
    @Query('storeIds') storeIds?: string,
    @Query('date') date?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveries.list(user, {
      status,
      storeId,
      storeIds,
      date,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('batch/accept')
  @HttpCode(200)
  @Permission('delivery.manage')
  @ApiOperation({ summary: '批量接单（逐条结果，已接单视为成功）' })
  batchAccept(@CurrentUser() user: AuthUser, @Body() dto: BatchAcceptDto) {
    return this.deliveries.batchAccept(user, dto.ids, {
      ...(dto.courierName ? { courierName: dto.courierName } : {}),
      ...(dto.courierPhone ? { courierPhone: dto.courierPhone } : {}),
    });
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Permission('delivery.manage')
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
  @Permission('delivery.manage')
  @ApiOperation({ summary: '送达：订单推进到已完成' })
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deliveries.deliver(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Permission('delivery.manage')
  @ApiOperation({ summary: '取消配送：仅待接单/配送中，需填写原因' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelDeliveryDto,
  ) {
    return this.deliveries.cancel(user, id, dto.reason);
  }
}
