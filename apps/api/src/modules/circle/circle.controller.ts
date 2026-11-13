import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { CircleService } from './circle.service';
import { CirclePostService, type PostAuditAction } from './circle-post.service';
import {
  CurrentUser as AdminCurrentUser,
  JwtAuthGuard,
  Permission,
  RolesGuard,
  type AuthUser,
} from '../../common/auth.guards';

class SaveCategoryDto {
  @IsString()
  @Length(1, 20)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  iconKey?: string | null;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class SaveTopicDto {
  @IsString()
  @Length(1, 30)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  coverKey?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class SaveSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['HYBRID', 'REVIEW'])
  auditMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  dailyPostLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  dailyCommentLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  postPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  postPointsDailyLimit?: number;
}

class AuditPostDto {
  @IsIn(['APPROVE', 'REJECT', 'HIDE'])
  action!: PostAuditAction;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

@ApiTags('admin-circle')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/circle')
export class AdminCircleController {
  constructor(
    private readonly circle: CircleService,
    private readonly posts: CirclePostService,
  ) {}

  @Get('categories')
  @Permission('circle.view')
  @ApiOperation({ summary: '圈子类目列表（含帖子数）' })
  listCategories() {
    return this.circle.listCategories();
  }

  @Post('categories')
  @Permission('circle.manage')
  @ApiOperation({ summary: '新建圈子类目' })
  createCategory(@Body() dto: SaveCategoryDto) {
    return this.circle.createCategory(dto);
  }

  @Patch('categories/:id')
  @Permission('circle.manage')
  @ApiOperation({ summary: '编辑 / 启停圈子类目' })
  updateCategory(@Param('id') id: string, @Body() dto: SaveCategoryDto) {
    return this.circle.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(200)
  @Permission('circle.manage')
  @ApiOperation({ summary: '删除圈子类目（有内容时禁止）' })
  removeCategory(@Param('id') id: string) {
    return this.circle.removeCategory(id);
  }

  @Get('topics')
  @Permission('circle.view')
  @ApiOperation({ summary: '圈子话题列表' })
  listTopics() {
    return this.circle.listTopics();
  }

  @Post('topics')
  @Permission('circle.manage')
  @ApiOperation({ summary: '新建圈子话题' })
  createTopic(@Body() dto: SaveTopicDto) {
    return this.circle.createTopic(dto);
  }

  @Patch('topics/:id')
  @Permission('circle.manage')
  @ApiOperation({ summary: '编辑 / 启停圈子话题' })
  updateTopic(@Param('id') id: string, @Body() dto: SaveTopicDto) {
    return this.circle.updateTopic(id, dto);
  }

  @Delete('topics/:id')
  @HttpCode(200)
  @Permission('circle.manage')
  @ApiOperation({ summary: '删除圈子话题（有内容时禁止）' })
  removeTopic(@Param('id') id: string) {
    return this.circle.removeTopic(id);
  }

  @Get('posts')
  @Permission('circle.audit')
  @ApiOperation({ summary: '圈子内容审核队列（含各状态数量，分页，可关键词筛选）' })
  listPosts(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.posts.listPosts({
      status,
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Patch('posts/:id/audit')
  @Permission('circle.audit')
  @ApiOperation({ summary: '审核圈子内容：通过 / 拒绝（必填原因）/ 隐藏' })
  auditPost(
    @Param('id') id: string,
    @Body() dto: AuditPostDto,
    @AdminCurrentUser() admin: AuthUser,
  ) {
    return this.posts.auditPost(id, dto.action, dto.note, admin.sub);
  }

  @Get('settings')
  @Permission('circle.view')
  @ApiOperation({ summary: '圈子设置' })
  getSettings() {
    return this.circle.getSettings();
  }

  @Patch('settings')
  @Permission('circle.manage')
  @ApiOperation({ summary: '保存圈子设置' })
  updateSettings(@Body() dto: SaveSettingsDto) {
    return this.circle.updateSettings(dto);
  }
}
