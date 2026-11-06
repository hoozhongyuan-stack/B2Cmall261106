import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { AdminAuthService } from './admin-auth.service';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AuthUser } from '../../common/auth.guards';

class LoginDto {
  @IsString()
  @Length(3, 64)
  account!: string;

  @IsString()
  @Length(6, 64)
  password!: string;
}

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '商家账号登录' })
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto.account, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录账号' })
  me(@CurrentUser() user: AuthUser) {
    return { id: user.sub, account: user.account, role: user.role, name: user.name };
  }
}
