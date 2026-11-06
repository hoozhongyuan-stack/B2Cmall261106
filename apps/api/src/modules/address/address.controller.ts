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
import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { AddressService } from './address.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class CreateAddressDto {
  @IsString()
  receiver!: string;

  @IsString()
  phone!: string;

  @IsString()
  region!: string;

  @IsString()
  detail!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class UpdateAddressDto {
  @IsOptional()
  @IsString()
  receiver?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('addresses')
export class AddressController {
  constructor(private readonly service: AddressService) {}

  @Get()
  @ApiOperation({ summary: '我的收货地址（默认地址排最前）' })
  list(@CurrentUser() user: MiniappUser) {
    return this.service.listMine(user.sub);
  }

  @Post()
  @ApiOperation({ summary: '新增收货地址' })
  create(@CurrentUser() user: MiniappUser, @Body() dto: CreateAddressDto) {
    return this.service.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改收货地址' })
  update(
    @CurrentUser() user: MiniappUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: '删除收货地址' })
  remove(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.remove(user.sub, id);
  }

  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({ summary: '设为默认地址' })
  setDefault(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.setDefault(user.sub, id);
  }
}
