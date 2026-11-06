import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OrderService } from './order.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class OrderLineDto {
  @IsString()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class PreviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items?: OrderLineDto[];

  @IsOptional()
  @IsString()
  couponClaimId?: string;

  @IsOptional()
  @IsString()
  region?: string;
}

class CreateOrderDto extends PreviewDto {
  @IsString()
  addressId!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: '结算预览：金额明细、可用券、运费' })
  preview(@CurrentUser() user: MiniappUser, @Body() dto: PreviewDto) {
    return this.orders.preview(user.sub, dto);
  }

  @Post()
  @ApiOperation({ summary: '创建订单（需 Idempotency-Key）' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '客户端生成的 UUID' })
  create(
    @CurrentUser() user: MiniappUser,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.orders.create(user.sub, dto, key);
  }

  @Get()
  @ApiOperation({ summary: '我的订单列表' })
  list(@CurrentUser() user: MiniappUser, @Query('status') status?: string) {
    return this.orders.list(user.sub, status);
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（含金额快照）' })
  detail(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.orders.view(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '取消未支付订单并释放库存' })
  cancel(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.orders.cancel(user.sub, id);
  }
}
