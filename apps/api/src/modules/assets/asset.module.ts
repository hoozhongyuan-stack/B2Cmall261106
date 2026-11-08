import { Module } from '@nestjs/common';

import { AssetService } from './asset.service';

/** 素材服务：后台素材库与小程序评价晒图共用，只做文件校验与落盘 */
@Module({
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
