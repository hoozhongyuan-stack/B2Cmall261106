import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ClientErrorDto {
  /** 来源端：便于在日志里区分后台与小程序 */
  @IsIn(['admin', 'miniapp'])
  source!: 'admin' | 'miniapp';

  @IsString()
  @MaxLength(200)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  /** 出错页面路径 / 路由 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;

  /** 若错误来自接口响应，带上服务端 requestId 以便串联日志 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  requestId?: string;
}
