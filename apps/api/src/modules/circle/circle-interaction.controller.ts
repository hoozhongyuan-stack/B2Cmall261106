import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CircleInteractionService } from './circle-interaction.service';
import {
  CurrentUser,
  OptionalCurrentUser,
  OptionalUserJwtGuard,
  UserJwtGuard,
  type MiniappUser,
} from '../../common/user-auth.guard';
import { RateLimit } from '../../common/rate-limit.guard';

class CreateCommentDto {
  @IsString()
  postId!: string;

  @IsString()
  @MaxLength(500)
  content!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class CreateReportDto {
  @IsIn(['POST', 'COMMENT', 'USER'])
  targetType!: string;

  @IsString()
  targetId!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}

class MarkNotificationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

@ApiTags('circle')
@Controller('circle')
export class CircleInteractionController {
  constructor(private readonly interactions: CircleInteractionService) {}

  @Get('posts')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '圈子信息流：推荐 / 最新 / 关注，游标分页，可按类目与话题筛选' })
  feed(
    @OptionalCurrentUser() user: MiniappUser | undefined,
    @Query('tab') tab?: string,
    @Query('categoryId') categoryId?: string,
    @Query('topicId') topicId?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.interactions.feed(user?.sub, {
      tab,
      categoryId,
      topicId,
      cursor,
      pageSize: Number(pageSize) || 10,
    });
  }

  @Get('search')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '圈子搜索：已发布内容与相关话题' })
  search(
    @OptionalCurrentUser() user: MiniappUser | undefined,
    @Query('keyword') keyword = '',
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.interactions.search(user?.sub, keyword, cursor, Number(pageSize) || 10);
  }

  @Get('posts/:id')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '帖子详情（返回点赞 / 收藏 / 关注状态）' })
  detail(@OptionalCurrentUser() user: MiniappUser | undefined, @Param('id') id: string) {
    return this.interactions.detail(user?.sub, id);
  }

  @Delete('posts/:id')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '作者删除自己的内容' })
  removePost(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.removePost(user.sub, id);
  }

  @Post('posts/:id/like')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞（幂等）' })
  like(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.like(user.sub, id);
  }

  @Delete('posts/:id/like')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消点赞（幂等）' })
  unlike(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.unlike(user.sub, id);
  }

  @Post('posts/:id/favorite')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '收藏（幂等）' })
  favorite(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.favorite(user.sub, id);
  }

  @Delete('posts/:id/favorite')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消收藏（幂等）' })
  unfavorite(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.unfavorite(user.sub, id);
  }

  @Get('posts/:id/comments')
  @ApiOperation({ summary: '评论列表（一级评论 + 回复）' })
  comments(@Param('id') id: string) {
    return this.interactions.comments(id);
  }

  @Post('comments')
  @UseGuards(UserJwtGuard)
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiBearerAuth()
  @ApiOperation({ summary: '发表评论 / 回复（限频与内容安全校验）' })
  createComment(@CurrentUser() user: MiniappUser, @Body() dto: CreateCommentDto) {
    return this.interactions.createComment(user.sub, dto);
  }

  @Delete('comments/:id')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除自己的评论（作者与楼主可删）' })
  removeComment(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.removeComment(user.sub, id);
  }

  @Post('reports')
  @UseGuards(UserJwtGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiBearerAuth()
  @ApiOperation({ summary: '举报帖子 / 评论 / 用户（重复举报拦截，3 次自动隐藏）' })
  report(@CurrentUser() user: MiniappUser, @Body() dto: CreateReportDto) {
    return this.interactions.createReport(user.sub, dto);
  }

  @Get('users/:id')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '用户主页：内容数、关注关系与关注状态' })
  userProfile(@OptionalCurrentUser() user: MiniappUser | undefined, @Param('id') id: string) {
    return this.interactions.userProfile(user?.sub, id);
  }

  @Get('users/:id/posts')
  @ApiOperation({ summary: '用户已发布内容' })
  userPosts(@Param('id') id: string) {
    return this.interactions.userPosts(id);
  }

  @Post('users/:id/follow')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '关注用户（幂等）' })
  follow(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.follow(user.sub, id);
  }

  @Delete('users/:id/follow')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消关注（幂等）' })
  unfollow(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.interactions.unfollow(user.sub, id);
  }

  @Get('me/favorites')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我收藏的内容' })
  myFavorites(@CurrentUser() user: MiniappUser) {
    return this.interactions.myFavorites(user.sub);
  }

  @Get('me/likes')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我点赞的内容' })
  myLikes(@CurrentUser() user: MiniappUser) {
    return this.interactions.myLikes(user.sub);
  }

  @Get('notifications')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '互动消息（含未读数）' })
  notifications(@CurrentUser() user: MiniappUser) {
    return this.interactions.notifications(user.sub);
  }

  @Post('notifications/read')
  @UseGuards(UserJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '标记互动消息已读（单条或全部）' })
  markRead(@CurrentUser() user: MiniappUser, @Body() dto: MarkNotificationsDto) {
    return this.interactions.markNotificationsRead(user.sub, dto);
  }
}
