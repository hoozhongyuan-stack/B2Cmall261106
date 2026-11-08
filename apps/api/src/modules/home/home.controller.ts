import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

import { HomeService } from './home.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

const LINK_TYPES = ['product', 'category', 'search', 'page', 'none'] as const;

class BannerDto {
  @IsString()
  @Length(1, 300)
  imageKey!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  title?: string | null;

  @IsIn(LINK_TYPES)
  linkType!: (typeof LINK_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 300)
  linkValue?: string | null;

  @IsInt()
  @Min(0)
  sort!: number;

  @IsBoolean()
  enabled!: boolean;
}

class NavDto {
  @IsString()
  @Length(1, 10)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  iconKey?: string | null;

  @IsIn(LINK_TYPES)
  linkType!: (typeof LINK_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 300)
  linkValue?: string | null;

  @IsInt()
  @Min(0)
  sort!: number;

  @IsBoolean()
  enabled!: boolean;
}

class SectionDto {
  @IsString()
  @Length(1, 20)
  title!: string;

  @IsArray()
  @IsString({ each: true })
  productIds!: string[];

  @IsInt()
  @Min(0)
  sort!: number;

  @IsBoolean()
  enabled!: boolean;
}

class SaveHomeLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BannerDto)
  banners!: BannerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NavDto)
  navs!: NavDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionDto)
  sections!: SectionDto[];
}

@ApiTags('home')
@Controller()
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get('home')
  @ApiOperation({ summary: '首页聚合：轮播 / 金刚区 / 推荐位 + 分类与精选兜底' })
  aggregate() {
    return this.home.aggregate();
  }
}

@ApiTags('admin-home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/home-layout')
export class AdminHomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '首页运营位配置（含停用项）' })
  detail() {
    return this.home.adminLayout();
  }

  @Put()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '保存首页运营位（全量替换，保存后即时生效）' })
  save(@Body() dto: SaveHomeLayoutDto) {
    return this.home.saveLayout(dto);
  }
}
