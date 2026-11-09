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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

import { AssetService, type UploadedImage } from './asset.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class CreateFolderDto {
  @IsString()
  @Length(1, 30)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class MoveAssetDto {
  /** 目标文件夹；null / 空字符串表示移到未分类 */
  @IsOptional()
  @IsString()
  folderId?: string | null;
}

class BatchIdsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('admin-assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/assets')
export class AdminAssetController {
  constructor(private readonly assets: AssetService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '素材列表（按文件夹、关键词筛选，分页）' })
  list(
    @Query('folderId') folderId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.assets.list({
      folderId,
      keyword,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get('folders')
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '一级文件夹列表（含素材数量）' })
  folders() {
    return this.assets.folders();
  }

  @Post('folders')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建文件夹' })
  createFolder(@Body() dto: CreateFolderDto) {
    return this.assets.createFolder(dto);
  }

  @Patch('folders/:id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '重命名或调整文件夹排序' })
  updateFolder(@Param('id') id: string, @Body() dto: UpdateFolderDto) {
    return this.assets.updateFolder(id, dto);
  }

  @Delete('folders/:id')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除空文件夹' })
  deleteFolder(@Param('id') id: string) {
    return this.assets.deleteFolder(id);
  }

  @Post('upload')
  @Roles('SUPER', 'OPS')
  @UseInterceptors(FilesInterceptor('files', 9, { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传图片（multipart，最多 9 张，单张 ≤5MB）' })
  upload(
    @UploadedFiles() files: UploadedImage[],
    @Body('folderId') folderId?: string,
  ) {
    return this.assets.upload(files ?? [], folderId);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '移动素材到文件夹' })
  move(@Param('id') id: string, @Body() dto: MoveAssetDto) {
    return this.assets.move(id, dto.folderId);
  }

  @Post('batch/delete')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '批量删除素材（被引用的逐条失败并返回原因）' })
  batchRemove(@Body() dto: BatchIdsDto) {
    return this.assets.batchRemove(dto.ids);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除素材（被商品或店铺 Logo 引用时拒绝）' })
  remove(@Param('id') id: string) {
    return this.assets.remove(id);
  }
}
