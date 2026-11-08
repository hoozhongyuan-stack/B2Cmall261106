import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { assetsDir } from './common/media';

/** 慢请求阈值：超过即打日志，便于定位性能退化 */
const SLOW_REQUEST_MS = 1000;

/**
 * 生产环境强制校验密钥强度，避免默认 dev 密钥上生产。
 * 出错直接退出进程，让部署流水线失败而不是带病上线。
 */
function assertProductionSecrets(config: ConfigService): void {
  if (config.get<string>('NODE_ENV') !== 'production') return;

  const secret = config.get<string>('JWT_SECRET')?.trim() ?? '';
  const weak =
    secret.length < 32 ||
    secret.includes('change-me') ||
    secret === 'dev-secret-change-me' ||
    secret === 'dev-secret-change-me-in-production';

  if (weak) {
    throw new Error('生产环境必须配置长度 ≥32 且非默认值的 JWT_SECRET');
  }
}

async function bootstrap(): Promise<void> {
  // rawBody：微信支付回调需要原始报文验签
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');

  // 素材库图片：本机磁盘静态托管，Nginx /api/ 反代即可
  const mediaDir = assetsDir();
  await mkdir(mediaDir, { recursive: true });
  app.useStaticAssets(mediaDir, {
    prefix: '/api/media/assets/',
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
  });

  assertProductionSecrets(app.get(ConfigService));

  app.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', req.requestId);
    const startedAt = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      if (duration >= SLOW_REQUEST_MS) {
        Logger.warn(
          `慢请求 ${duration}ms requestId=${req.requestId} ${req.method} ${req.originalUrl} status=${res.statusCode}`,
          'SlowRequest',
        );
      }
    });
    next();
  });

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // 未定义字段（如 points）直接 400
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('山野商城 API')
    .setDescription('B2C 商城接口；金额一律整数分')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
  Logger.log(`API 已启动：http://127.0.0.1:${port}/api/docs`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
