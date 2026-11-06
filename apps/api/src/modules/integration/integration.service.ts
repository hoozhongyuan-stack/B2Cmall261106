import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { PrismaService } from '../../prisma/prisma.module';

const CONFIG_ID = 'singleton';
const MAX_SECRET_BYTES = 200 * 1024;

export const SECRET_FIELDS = [
  'miniappAppSecret',
  'wechatPayApiV3Key',
  'wechatPayPrivateKey',
] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

interface SecretSpec {
  label: string;
  extensions: string[];
}

const SECRET_SPEC: Record<SecretField, SecretSpec> = {
  miniappAppSecret: { label: '小程序 AppSecret', extensions: ['.txt', '.key', '.secret'] },
  wechatPayApiV3Key: { label: '微信支付 APIv3 密钥', extensions: ['.txt', '.key', '.secret'] },
  wechatPayPrivateKey: {
    label: '微信支付商户私钥',
    extensions: ['.pem', '.key', '.p12', '.pfx'],
  },
};

export interface SecretMeta {
  configured: boolean;
  fileName: string | null;
}

export interface UpdateIntegrationInput {
  miniappAppId?: string;
  paymentProvider?: 'mock' | 'wechat';
  wechatPayMchId?: string;
  wechatPayCertSerial?: string;
  wechatPayNotifyUrl?: string;
  subscribeTemplateIds?: {
    orderPaid?: string;
    orderShipped?: string;
    refundResult?: string;
  };
  apiBaseUrl?: string;
  businessDomain?: string;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 读取 ---------------- */

  async detail() {
    const config = await this.ensureConfig();
    const templates = (config.subscribeTemplateIds ?? {}) as Record<string, string>;

    return {
      miniappAppId: config.miniappAppId,
      miniappAppSecret: this.meta(config.miniappAppSecretFile, config.miniappAppSecretName),
      paymentProvider: config.paymentProvider,
      wechatPayMchId: config.wechatPayMchId,
      wechatPayCertSerial: config.wechatPayCertSerial,
      wechatPayNotifyUrl: config.wechatPayNotifyUrl,
      wechatPayApiV3Key: this.meta(config.wechatPayApiV3KeyFile, config.wechatPayApiV3KeyName),
      wechatPayPrivateKey: this.meta(
        config.wechatPayPrivateKeyFile,
        config.wechatPayPrivateKeyName,
      ),
      subscribeTemplateIds: {
        orderPaid: templates.orderPaid ?? '',
        orderShipped: templates.orderShipped ?? '',
        refundResult: templates.refundResult ?? '',
      },
      apiBaseUrl: config.apiBaseUrl,
      businessDomain: config.businessDomain,
      updatedAt: config.updatedAt,
    };
  }

  /** 小程序登录用：AppID + AppSecret 明文（只在服务端使用） */
  async miniappCredentials(): Promise<{ appId: string; appSecret: string }> {
    const config = await this.ensureConfig();
    const appId = config.miniappAppId ?? process.env.MINIAPP_APPID ?? '';
    const appSecret = config.miniappAppSecretFile
      ? await this.readSecretFile(config.miniappAppSecretFile)
      : '';
    return { appId, appSecret };
  }

  async paymentProvider(): Promise<'mock' | 'wechat'> {
    const config = await this.ensureConfig();
    return config.paymentProvider === 'wechat' ? 'wechat' : 'mock';
  }

  /* ---------------- 写入 ---------------- */

  async update(input: UpdateIntegrationInput) {
    await this.ensureConfig();

    const data = {
      ...(input.miniappAppId !== undefined
        ? { miniappAppId: this.text(input.miniappAppId, 64) }
        : {}),
      ...(input.paymentProvider !== undefined
        ? { paymentProvider: this.provider(input.paymentProvider) }
        : {}),
      ...(input.wechatPayMchId !== undefined
        ? { wechatPayMchId: this.text(input.wechatPayMchId, 64) }
        : {}),
      ...(input.wechatPayCertSerial !== undefined
        ? { wechatPayCertSerial: this.text(input.wechatPayCertSerial, 128) }
        : {}),
      ...(input.wechatPayNotifyUrl !== undefined
        ? { wechatPayNotifyUrl: this.url(input.wechatPayNotifyUrl, '支付回调地址') }
        : {}),
      ...(input.subscribeTemplateIds !== undefined
        ? {
            subscribeTemplateIds: {
              orderPaid: this.text(input.subscribeTemplateIds.orderPaid ?? '', 64),
              orderShipped: this.text(input.subscribeTemplateIds.orderShipped ?? '', 64),
              refundResult: this.text(input.subscribeTemplateIds.refundResult ?? '', 64),
            },
          }
        : {}),
      ...(input.apiBaseUrl !== undefined
        ? { apiBaseUrl: this.url(input.apiBaseUrl, 'API 地址') }
        : {}),
      ...(input.businessDomain !== undefined
        ? { businessDomain: this.domain(input.businessDomain) }
        : {}),
    };

    return this.prisma.integrationConfig.update({ where: { id: CONFIG_ID }, data });
  }

  async uploadSecret(field: string, fileName: string, contentBase64: string) {
    const spec = this.spec(field);
    const name = (fileName ?? '').trim();
    if (!name) throw new BadRequestException('请选择要上传的文件');

    const ext = extname(name).toLowerCase();
    if (!spec.extensions.includes(ext)) {
      throw new BadRequestException(
        `${spec.label}仅支持 ${spec.extensions.join(' / ')} 格式`,
      );
    }

    const raw = (contentBase64 ?? '').replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) throw new BadRequestException('文件内容为空');
    if (buffer.length > MAX_SECRET_BYTES) {
      throw new BadRequestException('文件不能超过 200KB');
    }
    // 小程序 AppSecret 与 APIv3 密钥都是 32 位字母数字，避免误传私钥文件
    if (field === 'miniappAppSecret' || field === 'wechatPayApiV3Key') {
      if (!/^[A-Za-z0-9]{32}$/.test(buffer.toString('utf8').trim())) {
        throw new BadRequestException(
          `${spec.label}应为 32 位字母数字，请确认上传的不是密钥文件`,
        );
      }
    }

    const config = await this.ensureConfig();
    const oldFile = this.oldFile(config, field as SecretField);
    const target = join(
      secretDir(),
      `${field}-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`,
    );
    await mkdir(dirname(target), { recursive: true });
    // 密钥文件仅服务端可读
    await writeFile(target, buffer, { mode: 0o600 });

    if (oldFile) await this.removeFile(oldFile);

    return this.prisma.integrationConfig.update({
      where: { id: CONFIG_ID },
      data: this.fileColumns(field, target, name),
    });
  }

  async removeSecret(field: string) {
    this.spec(field);
    const config = await this.ensureConfig();
    const oldFile = this.oldFile(config, field as SecretField);
    if (oldFile) await this.removeFile(oldFile);

    await this.prisma.integrationConfig.update({
      where: { id: CONFIG_ID },
      data: this.clearColumns(field),
    });
    return { removed: true };
  }

  /* ---------------- 内部 ---------------- */

  async ensureConfig() {
    return this.prisma.integrationConfig.upsert({
      where: { id: CONFIG_ID },
      update: {},
      create: { id: CONFIG_ID },
    });
  }

  private async readSecretFile(file: string): Promise<string> {
    try {
      return (await readFile(file, 'utf8')).trim();
    } catch {
      this.logger.warn(`密钥文件读取失败：${file}`);
      return '';
    }
  }

  private async removeFile(file: string): Promise<void> {
    try {
      await unlink(file);
    } catch {
      /* 文件已不存在时忽略 */
    }
  }

  private meta(file: string | null, name: string | null): SecretMeta {
    return { configured: Boolean(file), fileName: file ? (name ?? '已上传') : null };
  }

  private spec(field: string): SecretSpec {
    if (!(SECRET_FIELDS as readonly string[]).includes(field)) {
      throw new BadRequestException('不支持的密钥类型');
    }
    return SECRET_SPEC[field as SecretField];
  }

  private oldFile(
    config: {
      miniappAppSecretFile: string | null;
      wechatPayApiV3KeyFile: string | null;
      wechatPayPrivateKeyFile: string | null;
    },
    field: SecretField,
  ): string | null {
    if (field === 'miniappAppSecret') return config.miniappAppSecretFile;
    if (field === 'wechatPayApiV3Key') return config.wechatPayApiV3KeyFile;
    return config.wechatPayPrivateKeyFile;
  }

  private fileColumns(field: string, file: string, name: string) {
    if (field === 'miniappAppSecret') {
      return { miniappAppSecretFile: file, miniappAppSecretName: name };
    }
    if (field === 'wechatPayApiV3Key') {
      return { wechatPayApiV3KeyFile: file, wechatPayApiV3KeyName: name };
    }
    return { wechatPayPrivateKeyFile: file, wechatPayPrivateKeyName: name };
  }

  private clearColumns(field: string) {
    if (field === 'miniappAppSecret') {
      return { miniappAppSecretFile: null, miniappAppSecretName: null };
    }
    if (field === 'wechatPayApiV3Key') {
      return { wechatPayApiV3KeyFile: null, wechatPayApiV3KeyName: null };
    }
    return { wechatPayPrivateKeyFile: null, wechatPayPrivateKeyName: null };
  }

  private text(value: string, max: number): string | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return null;
    if (trimmed.length > max) throw new BadRequestException(`内容长度不能超过 ${max} 个字符`);
    return trimmed;
  }

  private url(value: string, label: string): string | null {
    const text = this.text(value, 300);
    if (!text) return null;
    if (!/^https?:\/\/[^\s]+$/.test(text)) {
      throw new BadRequestException(`${label}必须是 http(s) 地址`);
    }
    return text;
  }

  private domain(value: string): string | null {
    const text = this.text(value, 200);
    if (!text) return null;
    if (!/^[a-zA-Z0-9.-]+$/.test(text)) {
      throw new BadRequestException('业务域名只能包含字母、数字、点与连字符');
    }
    return text;
  }

  private provider(value: string): 'mock' | 'wechat' {
    if (value !== 'mock' && value !== 'wechat') {
      throw new BadRequestException('支付渠道只能是 mock 或 wechat');
    }
    return value;
  }
}

/** 密钥落盘目录：可用 UPLOAD_DIR 覆盖，默认 <api>/uploads/secrets */
function secretDir(): string {
  const base = process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
  return join(base, 'secrets');
}
