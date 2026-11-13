import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CirclePostService } from './circle-post.service';
import { AssetService, type UploadedImage } from '../assets/asset.service';
import { RateLimit } from '../../common/rate-limit.guard';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class CreateCirclePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @IsString()
  categoryId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  topicIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  productIds?: string[];
}

@ApiTags('circle')
@Controller('circle')
export class CircleMemberController {
  constructor(
    private readonly posts: CirclePostService,
    private readonly assets: AssetService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '圈子启用类目（发布页 / 信息流筛选用）' })
  categories() {
    return this.posts.categories();
  }

  @Get('topics')
  @ApiOperation({ summary: '圈子话题（启用且未结束，可按类目筛选）' })
  topics(@Query('categoryId') categoryId?: string) {
    return this.posts.topics(categoryId);
  }

  @Post('images')
  @HttpCode(200)
  @UseGuards(UserJwtGuard)
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @UseInterceptors(FilesInterceptor('files', 9, { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '圈子图片上传（multipart，最多 9 张，单张 ≤5MB）' })
  async uploadImages(@UploadedFiles() files: UploadedImage[]) {
    return this.assets.upload(files ?? []);
  }

  @Post('posts')
  @UseGuards(UserJwtGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiBearerAuth()
  @ApiOperation({ summary: '发布圈子内容（限频、内容安全、按审核模式落状态）' })
  create(@CurrentUser() user: MiniappUser, @Body() dto: CreateCirclePostDto) {
    return this.posts.createPost(user.sub, dto);
  }

  @Get('me/posts')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的圈子内容（含审核状态与拒绝原因）' })
  mine(@CurrentUser() user: MiniappUser, @Query('status') status?: string) {
    return this.posts.listMyPosts(user.sub, status);
  }
}
