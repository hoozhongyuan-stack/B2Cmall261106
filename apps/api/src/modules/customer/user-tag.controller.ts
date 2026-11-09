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
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

import { UserTagService } from './user-tag.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class CreateUserTagDto {
  @IsString()
  @MaxLength(20)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

class UpdateUserTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  name?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

@ApiTags('admin-user-tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/user-tags')
export class AdminUserTagController {
  constructor(private readonly service: UserTagService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '用户标签树（两级，含覆盖人数）' })
  list() {
    return this.service.list();
  }

  @Get('options')
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '用户标签扁平选项（供筛选与打标选择）' })
  options() {
    return this.service.options();
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建一级 / 二级标签' })
  create(@Body() dto: CreateUserTagDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '重命名或调整排序' })
  update(@Param('id') id: string, @Body() dto: UpdateUserTagDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除标签（级联删除二级标签与用户绑定）' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
