import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { PrismaService } from '../../prisma/prisma.module';
import { RateLimit } from '../../common/rate-limit.guard';

class WechatLoginDto {
  /** 小程序 wx.login 返回的 code；开发阶段允许 mock_ 前缀直接换取 openid */
  @IsString()
  @Length(1, 128)
  code!: string;
}

@ApiTags('user-auth')
@Controller('auth')
export class UserAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('wechat-login')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: '小程序登录：code 换 openid 并签发 token' })
  async wechatLogin(@Body() dto: WechatLoginDto) {
    const openid = await this.resolveOpenid(dto.code);

    const user = await this.prisma.user.upsert({
      where: { openid },
      update: {},
      create: { openid, nickname: '山野顾客' },
    });

    return {
      token: await this.jwt.signAsync({ sub: user.id, scope: 'miniapp' }),
      user: { id: user.id, nickname: user.nickname, points: user.points },
    };
  }

  /**
   * 真实环境：调用微信 jscode2session（APPID + secret）换取 openid。
   * 当前阶段无 secret，使用 code 派生稳定 openid，保证同一 code 可重复登录、便于联调。
   */
  private async resolveOpenid(code: string): Promise<string> {
    const appId = process.env.MINIAPP_APPID ?? 'wx04619aa796c2188f';
    if (process.env.MINIAPP_SECRET) {
      const url =
        'https://api.weixin.qq.com/sns/jscode2session' +
        `?appid=${appId}&secret=${process.env.MINIAPP_SECRET}` +
        `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
      const res = await fetch(url);
      const data = (await res.json()) as { openid?: string; errmsg?: string };
      if (!data.openid) throw new Error(`微信登录失败：${data.errmsg ?? 'unknown'}`);
      return data.openid;
    }
    return `dev_${code}`.slice(0, 64);
  }
}
