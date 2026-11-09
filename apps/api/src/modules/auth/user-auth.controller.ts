import { BadRequestException, Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { AGREEMENT_VERSIONS } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { RateLimit } from '../../common/rate-limit.guard';
import { IntegrationService } from '../integration/integration.service';

class WechatLoginDto {
  /** 小程序 wx.login 返回的 code；开发阶段允许 dev_ 前缀直接换取 openid */
  @IsString()
  @Length(1, 128)
  code!: string;

  /** 登录页勾选协议后传 true；已同意过当前版本的静默续期可不传 */
  @IsOptional()
  @IsBoolean()
  agreed?: boolean;

  @IsOptional()
  @IsString()
  agreementVersion?: string;

  @IsOptional()
  @IsString()
  privacyVersion?: string;
}

const REQUIRED_CONSENTS = [
  { type: 'USER_AGREEMENT', version: AGREEMENT_VERSIONS.terms },
  { type: 'PRIVACY', version: AGREEMENT_VERSIONS.privacy },
] as const;

@ApiTags('user-auth')
@Controller('auth')
export class UserAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly integration: IntegrationService,
  ) {}

  @Post('wechat-login')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: '小程序登录：code 换 openid 并签发 token（首登需同意协议）' })
  async wechatLogin(
    @Body() dto: WechatLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const openid = await this.resolveOpenid(dto.code);

    const user = await this.prisma.user.upsert({
      where: { openid },
      update: {},
      create: { openid, nickname: '山野顾客' },
    });

    await this.assertConsent(user.id, dto, ip, userAgent);

    return {
      token: await this.jwt.signAsync({ sub: user.id, scope: 'miniapp' }),
      user: { id: user.id, nickname: user.nickname, points: user.points },
      agreements: AGREEMENT_VERSIONS,
    };
  }

  /**
   * 协议同意校验：
   * 1. 已同意当前版本 → 静默续期放行；
   * 2. 首次登录或协议升级 → 必须带 agreed + 当前版本号，并写入同意记录；
   * 3. 未同意 → 400，不签发 token。
   */
  private async assertConsent(
    userId: string,
    dto: WechatLoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const existing = await this.prisma.userConsent.findMany({
      where: {
        userId,
        OR: REQUIRED_CONSENTS.map((item) => ({ type: item.type, version: item.version })),
      },
      select: { type: true, version: true },
    });
    const missing = REQUIRED_CONSENTS.filter(
      (item) =>
        !existing.some((row) => row.type === item.type && row.version === item.version),
    );
    if (!missing.length) return;

    const accepted =
      dto.agreed === true &&
      dto.agreementVersion === AGREEMENT_VERSIONS.terms &&
      dto.privacyVersion === AGREEMENT_VERSIONS.privacy;
    if (!accepted) {
      throw new BadRequestException('请阅读并同意《用户协议》与《隐私政策》后登录');
    }

    await this.prisma.userConsent.createMany({
      data: missing.map((item) => ({
        userId,
        type: item.type,
        version: item.version,
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 256) ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * 真实环境：用后台配置的 AppID + AppSecret 调用 jscode2session 换取 openid。
   * `dev_` 前缀是 H5 预览的固定 code，非生产环境下直接派生 openid，
   * 避免后台上传 AppSecret 后本地预览无法登录；生产环境一律走微信。
   */
  private async resolveOpenid(code: string): Promise<string> {
    const devPreview = code.startsWith('dev_') && process.env.NODE_ENV !== 'production';

    if (!devPreview) {
      const { appId, appSecret } = await this.integration.miniappCredentials();

      if (appSecret) {
        const url =
          'https://api.weixin.qq.com/sns/jscode2session' +
          `?appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}` +
          `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
        const res = await fetch(url);
        const data = (await res.json()) as { openid?: string; errmsg?: string };
        if (!data.openid) throw new Error(`微信登录失败：${data.errmsg ?? 'unknown'}`);
        return data.openid;
      }
    }
    return `dev_${code}`.slice(0, 64);
  }
}
