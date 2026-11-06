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
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { CartService } from './cart.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class AddCartItemDto {
  @IsString()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class UpdateCartItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsBoolean()
  checked?: boolean;
}

class RemoveCartItemDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: '购物车（含失效商品区与勾选汇总）' })
  list(@CurrentUser() user: MiniappUser) {
    return this.cart.list(user.sub);
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({ summary: '加入购物车' })
  add(@CurrentUser() user: MiniappUser, @Body() dto: AddCartItemDto) {
    return this.cart.add(user.sub, dto.skuId, dto.quantity);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '修改数量或勾选状态' })
  update(
    @CurrentUser() user: MiniappUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.update(user.sub, id, dto);
  }

  @Delete('items')
  @ApiOperation({ summary: '删除指定商品' })
  remove(@CurrentUser() user: MiniappUser, @Body() dto: RemoveCartItemDto) {
    return this.cart.remove(user.sub, dto.ids);
  }

  @Delete('invalid')
  @ApiOperation({ summary: '清空失效商品' })
  clearInvalid(@CurrentUser() user: MiniappUser) {
    return this.cart.clearInvalid(user.sub);
  }
}
