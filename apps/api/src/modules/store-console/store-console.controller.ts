import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { StoreConsoleService } from './store-console.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class VerifyPickupDto {
  @IsString()
  @Matches(/^\d{8}$/)
  code!: string;
}

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

class ConsoleDeliveryQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

class ConsoleStockQuery {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  warning?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

class AdjustStockDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  safetyStock?: number;
}

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notice?: string;

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;
}

class ClosureDto {
  /** ISO 时间；传 null / 空字符串表示立即恢复营业 */
  @IsOptional()
  @IsString()
  until?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

@ApiTags('store-console')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('store-console')
export class StoreConsoleController {
  constructor(private readonly service: StoreConsoleService) {}

  @Get('context')
  @ApiOperation({ summary: '门店中心入口：当前会员是否关联门店' })
  context(@CurrentUser() user: MiniappUser) {
    return this.service.context(user.sub);
  }

  @Get('summary')
  @ApiOperation({ summary: '门店工作台：待办与今日经营' })
  summary(@CurrentUser() user: MiniappUser) {
    return this.service.summary(user.sub);
  }

  @Post('pickups/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '门店核销自提码' })
  verifyPickup(@CurrentUser() user: MiniappUser, @Body() dto: VerifyPickupDto) {
    return this.service.verifyPickup(user.sub, dto.code);
  }

  @Get('deliveries')
  @ApiOperation({ summary: '本店配送单列表' })
  deliveries(@CurrentUser() user: MiniappUser, @Query() query: ConsoleDeliveryQuery) {
    return this.service.listDeliveries(user.sub, {
      status: query.status,
      date: query.date,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
    });
  }

  @Post('deliveries/:id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: '门店接单' })
  accept(@CurrentUser() user: MiniappUser, @Param('id') id: string, @Body() dto: AcceptDeliveryDto) {
    return this.service.acceptDelivery(user.sub, id, dto);
  }

  @Post('deliveries/:id/deliver')
  @HttpCode(200)
  @ApiOperation({ summary: '门店送达' })
  deliver(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.deliverOrder(user.sub, id);
  }

  @Get('stock')
  @ApiOperation({ summary: '本店库存：关键词 / 只看预警 / 分页' })
  stock(@CurrentUser() user: MiniappUser, @Query() query: ConsoleStockQuery) {
    return this.service.listStock(user.sub, {
      keyword: query.keyword,
      warning: query.warning === '1' || query.warning === 'true',
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
    });
  }

  @Post('stock/:skuId/adjust')
  @HttpCode(200)
  @ApiOperation({ summary: '调整本店库存与安全库存' })
  adjustStock(
    @CurrentUser() user: MiniappUser,
    @Param('skuId') skuId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.service.adjustStock(user.sub, skuId, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: '营业设置：营业时间、公告与履约开关' })
  settings(@CurrentUser() user: MiniappUser) {
    return this.service.settings(user.sub);
  }

  @Patch('settings')
  @ApiOperation({ summary: '更新营业设置（仅本店，不允许改编码/状态）' })
  updateSettings(@CurrentUser() user: MiniappUser, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(user.sub, dto);
  }

  @Get('dashboard')
  @ApiOperation({ summary: '移动端门店看板：今日经营、待履约、配送时效与库存预警' })
  dashboard(@CurrentUser() user: MiniappUser) {
    return this.service.dashboard(user.sub);
  }

  @Post('closure')
  @HttpCode(200)
  @ApiOperation({ summary: '临时打烊 / 恢复营业（最长 7 天）' })
  setClosure(@CurrentUser() user: MiniappUser, @Body() dto: ClosureDto) {
    return this.service.setClosure(user.sub, dto);
  }
}
