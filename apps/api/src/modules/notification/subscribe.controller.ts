import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { NotificationService } from './notification.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('templates')
  @ApiOperation({ summary: '订阅消息模板 ID（小程序发起订阅授权使用，仅返回已配置项）' })
  templates() {
    return this.notifications.configuredTemplates();
  }
}
