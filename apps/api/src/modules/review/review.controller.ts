import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ReviewService } from './review.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class CreateReviewDto {
  @IsString()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;
}

class ModerateReviewDto {
  @IsIn(['show', 'hide'])
  action!: 'show' | 'hide';
}

class ReplyReviewDto {
  @IsString()
  content!: string;
}

@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  @ApiOperation({ summary: '发布评价（仅已完成订单，先审后显）' })
  create(@CurrentUser() user: MiniappUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.sub, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: '我的评价' })
  listMine(@CurrentUser() user: MiniappUser) {
    return this.reviews.listMine(user.sub);
  }

  @Get('context/:orderItemId')
  @ApiOperation({ summary: '评价页上下文：商品信息与是否已评价' })
  context(@CurrentUser() user: MiniappUser, @Param('orderItemId') orderItemId: string) {
    return this.reviews.context(user.sub, orderItemId);
  }
}

/** 商品评价公开接口：无需登录，供商品详情页与评价列表页使用 */
@ApiTags('reviews')
@Controller('products')
export class ProductReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get(':id/reviews')
  @ApiOperation({ summary: '商品评价与评分分布（仅展示审核通过的评价）' })
  listByProduct(@Param('id') id: string) {
    return this.reviews.listByProduct(id);
  }
}

@ApiTags('admin-reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '评价列表（含各状态数量，分页）' })
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reviews.listAdmin(status, Number(page) || 1, Number(pageSize) || 20);
  }

  @Post(':id/moderate')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '审核评价：通过展示 / 隐藏' })
  moderate(@Param('id') id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.action);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '商家回复评价' })
  reply(@Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.reviews.reply(id, dto.content);
  }
}
