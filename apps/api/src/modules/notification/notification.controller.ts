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

import { NotificationService } from './notification.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class TestNotificationDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  userId?: string;
}

@ApiTags('admin-notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get('logs')
  @Permission('integration.view')
  @ApiOperation({ summary: '订阅消息发送日志（按状态/场景筛选）' })
  logs(
    @Query('status') status?: string,
    @Query('scene') scene?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listLogs({
      status: status?.trim() || undefined,
      scene: scene?.trim() || undefined,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('test')
  @HttpCode(200)
  @Permission('notification.manage')
  @ApiOperation({ summary: '测试发送一条订阅消息（使用订单支付模板）' })
  test(@Body() dto: TestNotificationDto) {
    return this.service.sendTest(dto.userId);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Permission('notification.manage')
  @ApiOperation({ summary: '立即重试一条失败或跳过的通知' })
  retry(@Param('id') id: string) {
    return this.service.retry(id);
  }
}
