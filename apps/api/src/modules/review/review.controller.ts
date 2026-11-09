import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ReviewService } from './review.service';
import { AssetService, type UploadedImage } from '../assets/asset.service';
import { RateLimit } from '../../common/rate-limit.guard';
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
  constructor(
    private readonly reviews: ReviewService,
    private readonly assets: AssetService,
  ) {}

  @Post()
  @ApiOperation({ summary: '发布评价（仅已完成订单，先审后显）' })
  create(@CurrentUser() user: MiniappUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.sub, dto);
  }

  @Post('images')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @UseInterceptors(FilesInterceptor('files', 9, { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '评价晒图上传（multipart，最多 9 张，单张 ≤5MB）' })
  async uploadImages(@UploadedFiles() files: UploadedImage[]) {
    return this.assets.upload(files ?? []);
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

class BatchModerateDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['show', 'hide'])
  action!: 'show' | 'hide';
}

@ApiTags('admin-reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '评价列表（含各状态数量，分页，可关键词 / 评分 / 时间筛选）' })
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('rating') rating?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reviews.listAdmin(status, Number(page) || 1, Number(pageSize) || 20, {
      keyword,
      rating: rating ? Number(rating) : undefined,
      startDate,
      endDate,
    });
  }

  @Post('batch/moderate')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '批量审核评价：通过展示 / 隐藏' })
  batchModerate(@Body() dto: BatchModerateDto) {
    return this.reviews.batchModerate(dto.ids, dto.action);
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
