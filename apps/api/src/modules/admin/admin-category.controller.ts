import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

import { AdminTaxonomyService } from './admin-taxonomy.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class TagNameDto {
  @IsString()
  name!: string;
}

@ApiTags('admin-categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/categories')
export class AdminCategoryController {
  constructor(private readonly service: AdminTaxonomyService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '分类树（最多两级，含商品数）' })
  tree() {
    return this.service.categoryTree();
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建分类' })
  create(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '修改分类名称 / 父级 / 排序' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除分类（有子分类或商品时不可删）' })
  remove(@Param('id') id: string) {
    return this.service.removeCategory(id);
  }
}

@ApiTags('admin-tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/tags')
export class AdminTagController {
  constructor(private readonly service: AdminTaxonomyService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '标签列表（含所指派商品）' })
  list() {
    return this.service.listTags();
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建标签' })
  create(@Body() dto: TagNameDto) {
    return this.service.createTag(dto);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '重命名标签' })
  update(@Param('id') id: string, @Body() dto: TagNameDto) {
    return this.service.updateTag(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除标签' })
  remove(@Param('id') id: string) {
    return this.service.removeTag(id);
  }
}
