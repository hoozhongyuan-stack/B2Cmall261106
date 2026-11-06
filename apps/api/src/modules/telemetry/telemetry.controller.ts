import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RateLimit } from '../../common/rate-limit.guard';
import { ClientErrorDto } from './telemetry.dto';

/**
 * 客户端错误上报：前端未捕获异常 / 接口调用失败时调用。
 * 单行结构化日志，便于按 requestId、source、path 聚合排查。
 */
@ApiTags('telemetry')
@Controller('telemetry')
export class TelemetryController {
  private readonly logger = new Logger('ClientError');

  @Post('client-error')
  @HttpCode(204)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: '客户端错误上报（无需登录）' })
  report(@Body() dto: ClientErrorDto, @Req() req: Request): void {
    const firstLine = dto.stack?.split('\n')[0]?.trim() ?? '';
    this.logger.warn(
      [
        `source=${dto.source}`,
        `requestId=${dto.requestId ?? req.requestId ?? '-'}`,
        `path=${dto.path ?? '-'}`,
        `ip=${req.ip ?? '-'}`,
        `name=${dto.name ?? '-'}`,
        `message=${dto.message}`,
        firstLine ? `stack=${firstLine}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
}
