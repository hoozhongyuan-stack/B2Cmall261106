import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { AdminAccountService, type AccountStatus } from './admin-account.service';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AdminRole, type AuthUser } from '../../common/auth.guards';

const ROLES: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];

class CreateAccountDto {
  @IsString()
  account!: string;

  @IsString()
  displayName!: string;

  @IsIn(ROLES)
  role!: AdminRole;

  @IsString()
  @MinLength(8)
  password!: string;
}

class UpdateAccountDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: AdminRole;
}

class SetStatusDto {
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: AccountStatus;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

@ApiTags('admin-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/accounts')
export class AdminAccountController {
  constructor(private readonly accounts: AdminAccountService) {}

  @Get()
  @Roles('SUPER')
  @ApiOperation({ summary: '子账号列表（不含密码）' })
  list() {
    return this.accounts.list();
  }

  @Post()
  @Roles('SUPER')
  @ApiOperation({ summary: '新建子账号' })
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '修改子账号昵称或角色' })
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '启用 / 停用子账号' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.accounts.setStatus(id, dto.status, user.sub);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '重置子账号密码并解除锁定' })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.accounts.resetPassword(id, dto.password);
  }
}
