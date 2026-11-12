import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, Length } from 'class-validator';

import { MicroPageService } from './micro-page.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class CreateMicroPageDto {
  @IsString()
  @Length(1, 20)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(2, 32)
  code?: string;

  @IsOptional()
  @IsString()
  copyFromId?: string;
}

class SaveMicroPageDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  title?: string;

  @IsOptional()
  @IsArray()
  components?: unknown[];

  @IsOptional()
  settings?: Record<string, unknown>;

  /** 乐观锁：提交时带上最近一次读取的 updatedAt */
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;
}

class SaveTabbarDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  style?: Record<string, unknown>;

  @IsArray()
  items!: unknown[];
}

@ApiTags('micro-page')
@Controller()
export class MicroPageController {
  constructor(private readonly pages: MicroPageService) {}

  @Get('micro-pages/:code')
  @ApiOperation({ summary: '小程序读取已发布的微页面快照' })
  publicPage(@Param('code') code: string) {
    return this.pages.publicPage(code);
  }

  @Get('shop/shell')
  @ApiOperation({ summary: '小程序启动配置：底部导航、首页微页面与渲染方式' })
  shell() {
    return this.pages.shell();
  }
}

@ApiTags('admin-micro-page')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/micro-pages')
export class AdminMicroPageController {
  constructor(private readonly pages: MicroPageService) {}

  @Get()
  @Permission('micropage.view')
  @ApiOperation({ summary: '微页面列表（关键字 / 状态筛选，分页）' })
  list(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pages.listAdmin({
      keyword,
      status,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Post('migrate-home')
  @HttpCode(200)
  @Permission('micropage.manage')
  @ApiOperation({ summary: '把现有首页运营位迁移为 home 微页面（可重复执行）' })
  migrateHome() {
    return this.pages.migrateLegacyHome();
  }

  @Post()
  @Permission('micropage.manage')
  @ApiOperation({ summary: '新建微页面（可复制现有页面内容）' })
  create(@Body() dto: CreateMicroPageDto) {
    return this.pages.create(dto);
  }

  @Get(':id')
  @Permission('micropage.view')
  @ApiOperation({ summary: '微页面详情（草稿 + 发布快照）' })
  detail(@Param('id') id: string) {
    return this.pages.detail(id);
  }

  @Put(':id')
  @Permission('micropage.manage')
  @ApiOperation({ summary: '保存草稿（不影线上快照）' })
  save(@Param('id') id: string, @Body() dto: SaveMicroPageDto) {
    return this.pages.saveDraft(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Permission('micropage.manage')
  @ApiOperation({ summary: '全量校验后发布当前草稿' })
  publish(@Param('id') id: string) {
    return this.pages.publish(id);
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @Permission('micropage.manage')
  @ApiOperation({ summary: '回滚到上一版发布快照' })
  rollback(@Param('id') id: string) {
    return this.pages.rollback(id);
  }

  @Post(':id/duplicate')
  @Permission('micropage.manage')
  @ApiOperation({ summary: '复制为新草稿' })
  duplicate(@Param('id') id: string) {
    return this.pages.duplicate(id);
  }

  @Post(':id/home')
  @HttpCode(200)
  @Permission('micropage.manage')
  @ApiOperation({ summary: '设为小程序首页（需已上线）' })
  setHome(@Param('id') id: string) {
    return this.pages.setHome(id);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permission('micropage.manage')
  @ApiOperation({ summary: '删除微页面（被引用时拒绝）' })
  remove(@Param('id') id: string) {
    return this.pages.remove(id);
  }
}

@ApiTags('admin-micro-page')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/link-options')
export class AdminLinkOptionsController {
  constructor(private readonly pages: MicroPageService) {}

  @Get()
  @Permission('micropage.view')
  @ApiOperation({ summary: '统一链接选择器数据源' })
  options(
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pages.linkOptions(type ?? 'none', keyword, Number(limit) || 20);
  }
}

@ApiTags('admin-micro-page')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/tabbar')
export class AdminTabbarController {
  constructor(private readonly pages: MicroPageService) {}

  @Get()
  @Permission('tabbar.view')
  @ApiOperation({ summary: '读取底部导航配置' })
  detail() {
    return this.pages.tabbar();
  }

  @Put()
  @Permission('tabbar.manage')
  @ApiOperation({ summary: '保存底部导航（2~5 个入口，必须有首页）' })
  save(@Body() dto: SaveTabbarDto) {
    return this.pages.saveTabbar(dto);
  }
}
