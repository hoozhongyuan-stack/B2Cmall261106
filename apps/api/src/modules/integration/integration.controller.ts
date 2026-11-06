import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { IntegrationService } from './integration.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class SubscribeTemplatesDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  orderPaid?: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  orderShipped?: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  refundResult?: string;
}

class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  miniappAppId?: string;

  /** 32 位字母数字；空字符串表示清除 */
  @IsOptional()
  @IsString()
  @Length(0, 64)
  miniappAppSecret?: string;

  @IsOptional()
  @IsIn(['mock', 'wechat'])
  paymentProvider?: 'mock' | 'wechat';

  @IsOptional()
  @IsString()
  @Length(0, 64)
  wechatPayMchId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  wechatPayCertSerial?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  wechatPayNotifyUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SubscribeTemplatesDto)
  subscribeTemplateIds?: SubscribeTemplatesDto;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  businessDomain?: string;
}

class UploadSecretDto {
  /** 原始文件名，用于校验格式与后台展示 */
  @IsString()
  @Length(1, 200)
  fileName!: string;

  /** 文件内容（base64，可带 data URL 前缀） */
  @IsString()
  @Length(1, 400_000)
  contentBase64!: string;
}

@ApiTags('admin-integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/integration')
export class AdminIntegrationController {
  constructor(private readonly service: IntegrationService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '集成配置（密钥只返回是否已配置与文件名）' })
  detail() {
    return this.service.detail();
  }

  @Patch()
  @Roles('SUPER')
  @ApiOperation({ summary: '修改集成配置（小程序 / 支付 / 订阅消息 / 域名）' })
  update(@Body() dto: UpdateIntegrationDto) {
    return this.service.update(dto);
  }

  @Post('secrets/:field')
  @Roles('SUPER')
  @ApiOperation({ summary: '上传密钥或证书文件（base64）' })
  upload(@Param('field') field: string, @Body() dto: UploadSecretDto) {
    return this.service.uploadSecret(field, dto.fileName, dto.contentBase64);
  }

  @Delete('secrets/:field')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '删除已上传的密钥或证书' })
  remove(@Param('field') field: string) {
    return this.service.removeSecret(field);
  }
}
