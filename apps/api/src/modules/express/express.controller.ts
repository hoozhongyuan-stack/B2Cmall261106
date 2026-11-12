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
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

import { ExpressService } from './express.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class ExpressCompanyDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  code?: string;

  @IsString()
  @Length(1, 20)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class UpdateExpressCompanyDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@ApiTags('express')
@Controller('express-companies')
export class ExpressCompanyController {
  constructor(private readonly express: ExpressService) {}

  @Get()
  @ApiOperation({ summary: '启用的物流公司（发货选择与导入使用）' })
  list() {
    return this.express.list(false);
  }
}

@ApiTags('admin-express')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/express-companies')
export class AdminExpressCompanyController {
  constructor(private readonly express: ExpressService) {}

  @Get()
  @Permission('express.view')
  @ApiOperation({ summary: '物流公司列表（含停用项）' })
  list() {
    return this.express.list(true);
  }

  @Post()
  @Permission('express.manage')
  @ApiOperation({ summary: '新增物流公司' })
  create(@Body() dto: ExpressCompanyDto) {
    return this.express.create(dto);
  }

  @Patch(':id')
  @Permission('express.manage')
  @ApiOperation({ summary: '修改物流公司名称 / 排序 / 启停' })
  update(@Param('id') id: string, @Body() dto: UpdateExpressCompanyDto) {
    return this.express.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permission('express.manage')
  @ApiOperation({ summary: '删除物流公司（仅用于录入错误时清理）' })
  remove(@Param('id') id: string) {
    return this.express.remove(id);
  }
}
