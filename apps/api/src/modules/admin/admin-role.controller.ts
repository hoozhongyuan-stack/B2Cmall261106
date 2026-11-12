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
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, Length } from 'class-validator';

import { PERMISSION_GROUPS } from '@shanye/shared';

import { AdminRoleService } from './admin-role.service';
import { JwtAuthGuard, Permission, RolesGuard } from '../../common/auth.guards';

class RoleDto {
  @IsString()
  @Length(1, 20)
  name!: string;

  @IsString()
  @Length(1, 200)
  description!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissions!: string[];
}

@ApiTags('admin-roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminRoleController {
  constructor(private readonly roles: AdminRoleService) {}

  @Get('permissions')
  @Permission('role.view')
  @ApiOperation({ summary: '权限目录（分组）' })
  permissions() {
    return { groups: PERMISSION_GROUPS };
  }

  @Get('roles')
  @Permission('role.view')
  @ApiOperation({ summary: '角色列表' })
  list() {
    return this.roles.list();
  }

  @Get('roles/:id')
  @Permission('role.view')
  @ApiOperation({ summary: '角色详情' })
  detail(@Param('id') id: string) {
    return this.roles.detail(id);
  }

  @Post('roles')
  @Permission('role.manage')
  @ApiOperation({ summary: '新建角色' })
  create(@Body() dto: RoleDto) {
    return this.roles.create(dto);
  }

  @Patch('roles/:id')
  @HttpCode(200)
  @Permission('role.manage')
  @ApiOperation({ summary: '编辑角色' })
  update(@Param('id') id: string, @Body() dto: RoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete('roles/:id')
  @Permission('role.manage')
  @ApiOperation({ summary: '删除角色（仍有账号使用时拒绝）' })
  remove(@Param('id') id: string) {
    return this.roles.remove(id);
  }
}
