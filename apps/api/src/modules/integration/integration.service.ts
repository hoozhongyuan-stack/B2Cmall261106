import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { PrismaService } from '../../prisma/prisma.module';
import type { WechatPayConfig } from '../payment/wechat/wechat-pay.config';

const CONFIG_ID = 'singleton';
const MAX_SECRET_BYTES = 200 * 1024;

/** 需要以文件形式保存的密钥（AppSecret 改为后台文本录入，不再走文件） */
export const SECRET_FIELDS = [
  'miniappUploadKey',
  'wechatPayApiV3Key',
  'wechatPayPrivateKey',
  'wechatPayPublicKey',
] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

interface SecretSpec {
  label: string;
  extensions: string[];
}

const SECRET_SPEC: Record<SecretField, SecretSpec> = {
  miniappUploadKey: { label: '小程序代码上传密钥', extensions: ['.key', '.pem'] },
  wechatPayApiV3Key: { label: '微信支付 APIv3 密钥', extensions: ['.txt', '.key', '.secret'] },
  wechatPayPrivateKey: {
    label: '微信支付商户私钥',
    extensions: ['.pem', '.key', '.p12', '.pfx'],
  },
  wechatPayPublicKey: {
    label: '微信支付公钥',
    extensions: ['.pem', '.txt', '.key'],
  },
};

export interface SecretMeta {
  configured: boolean;
  fileName: string | null;
}

export interface UpdateIntegrationInput {
  miniappAppId?: string;
  /** 小程序 AppSecret（32 位字母数字）；空字符串表示清除 */
  miniappAppSecret?: string;
  paymentProvider?: 'mock' | 'wechat';
  wechatPayMchId?: string;
  wechatPayCertSerial?: string;
  wechatPayNotifyUrl?: string;
  /** 微信支付公钥 ID（公钥模式必填，平台证书模式留空） */
  wechatPayPublicKeyId?: string;
  subscribeTemplateIds?: {
    orderPaid?: string;
    orderShipped?: string;
    refundResult?: string;
    pickupReady?: string;
    pickupExpiring?: string;
    deliveryAccepted?: string;
    deliveryDone?: string;
  };
  /** 模板字段映射：{ 场景: { 微信字段名: 变量名 } } */
  subscribeTemplateFields?: Record<string, Record<string, string>>;
  apiBaseUrl?: string;
  businessDomain?: string;
}

@Injectable()
export class IntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 读取 ---------------- */

  async detail() {
    const config = await this.ensureConfig();
    const templates = (config.subscribeTemplateIds ?? {}) as Record<string, string>;

    return {
      miniappAppId: config.miniappAppId,
      miniappAppSecret: { configured: Boolean(config.miniappAppSecret) },
      miniappUploadKey: this.meta(config.miniappUploadKeyFile, config.miniappUploadKeyName),
      paymentProvider: config.paymentProvider,
      wechatPayMchId: config.wechatPayMchId,
      wechatPayCertSerial: config.wechatPayCertSerial,
      wechatPayNotifyUrl: config.wechatPayNotifyUrl,
      wechatPayApiV3Key: this.meta(config.wechatPayApiV3KeyFile, config.wechatPayApiV3KeyName),
      wechatPayPrivateKey: this.meta(
        config.wechatPayPrivateKeyFile,
        config.wechatPayPrivateKeyName,
      ),
      wechatPayPublicKeyId: config.wechatPayPublicKeyId,
      wechatPayPublicKey: this.meta(
        config.wechatPayPublicKeyFile,
        config.wechatPayPublicKeyName,
      ),
      subscribeTemplateIds: {
        orderPaid: templates.orderPaid ?? '',
        orderShipped: templates.orderShipped ?? '',
        refundResult: templates.refundResult ?? '',
        pickupReady: templates.pickupReady ?? '',
        pickupExpiring: templates.pickupExpiring ?? '',
        deliveryAccepted: templates.deliveryAccepted ?? '',
        deliveryDone: templates.deliveryDone ?? '',
      },
      subscribeTemplateFields: (config.subscribeTemplateFields ?? {}) as Record<
        string,
        Record<string, string>
      >,
      apiBaseUrl: config.apiBaseUrl,
      businessDomain: config.businessDomain,
      updatedAt: config.updatedAt,
    };
  }

  /** 小程序登录用：AppID + AppSecret 明文（只在服务端使用） */
  async miniappCredentials(): Promise<{ appId: string; appSecret: string }> {
    const config = await this.ensureConfig();
    return {
      appId: config.miniappAppId ?? process.env.MINIAPP_APPID ?? '',
      appSecret: config.miniappAppSecret ?? process.env.MINIAPP_SECRET ?? '',
    };
  }

  async paymentProvider(): Promise<'mock' | 'wechat'> {
    const config = await this.ensureConfig();
    return config.paymentProvider === 'wechat' ? 'wechat' : 'mock';
  }

  /** 订阅消息运行参数：模板 ID 与字段映射（供通知服务使用） */
  async subscribeTemplateConfig(): Promise<{
    templates: {
      orderPaid: string;
      orderShipped: string;
      refundResult: string;
      pickupReady: string;
      pickupExpiring: string;
      deliveryAccepted: string;
      deliveryDone: string;
    };
    fields: Record<string, Record<string, string>>;
  }> {
    const config = await this.ensureConfig();
    const templates = (config.subscribeTemplateIds ?? {}) as Record<string, string>;
    return {
      templates: {
        orderPaid: templates.orderPaid ?? '',
        orderShipped: templates.orderShipped ?? '',
        refundResult: templates.refundResult ?? '',
        pickupReady: templates.pickupReady ?? '',
        pickupExpiring: templates.pickupExpiring ?? '',
        deliveryAccepted: templates.deliveryAccepted ?? '',
        deliveryDone: templates.deliveryDone ?? '',
      },
      fields: (config.subscribeTemplateFields ?? {}) as Record<string, Record<string, string>>,
    };
  }

  /** 小程序发布用：AppID、代码上传密钥路径、API 地址 */
  async miniappPublishConfig(): Promise<{
    appId: string;
    uploadKeyPath: string | null;
    apiBaseUrl: string;
  }> {
    const config = await this.ensureConfig();
    return {
      appId: config.miniappAppId ?? process.env.MINIAPP_APPID ?? '',
      uploadKeyPath: config.miniappUploadKeyFile,
      apiBaseUrl: config.apiBaseUrl ?? process.env.MINIAPP_API_BASE ?? '',
    };
  }

  /** 微信支付运行参数：读取服务端密钥文件，缺失时给出可操作的错误 */
  async wechatPayConfig(): Promise<WechatPayConfig> {
    const config = await this.ensureConfig();
    const missing: string[] = [];

    const appId = config.miniappAppId ?? process.env.MINIAPP_APPID ?? '';
    if (!appId) missing.push('小程序 AppID');

    const mchId = (config.wechatPayMchId ?? '').trim();
    if (!mchId) missing.push('商户号');

    const certSerial = (config.wechatPayCertSerial ?? '').trim();
    if (!certSerial) missing.push('商户证书序列号');

    const notifyUrl = (config.wechatPayNotifyUrl ?? '').trim();
    if (!notifyUrl) missing.push('支付回调地址');

    const apiV3Key = await this.readSecret(config.wechatPayApiV3KeyFile, 'APIv3 密钥', missing);
    if (apiV3Key && !/^[A-Za-z0-9]{32}$/.test(apiV3Key)) {
      missing.push('APIv3 密钥（应为 32 位字母数字）');
    }

    const privateKeyPem = await this.readSecret(
      config.wechatPayPrivateKeyFile,
      '商户私钥',
      missing,
    );
    if (privateKeyPem && !privateKeyPem.includes('BEGIN')) {
      missing.push('商户私钥（需 PEM 格式，p12/pfx 请先转换）');
    }

    const publicKeyId = config.wechatPayPublicKeyId?.trim() || undefined;
    const publicKeyPem = config.wechatPayPublicKeyFile
      ? await this.readSecret(config.wechatPayPublicKeyFile, '微信支付公钥', missing)
      : undefined;
    if (publicKeyId && !publicKeyPem) missing.push('微信支付公钥');

    if (missing.length) {
      throw new ServiceUnavailableException(
        `微信支付未配置完整：${missing.join('、')}。请在后台「集成配置 → 微信支付」补齐`,
      );
    }

    return {
      appId,
      mchId,
      certSerial,
      notifyUrl,
      apiV3Key,
      privateKeyPem,
      publicKeyId,
      publicKeyPem,
    };
  }

  private async readSecret(
    file: string | null,
    label: string,
    missing: string[],
  ): Promise<string> {
    if (!file) {
      missing.push(label);
      return '';
    }
    try {
      return (await readFile(file, 'utf8')).trim();
    } catch {
      missing.push(`${label}（文件不可读）`);
      return '';
    }
  }

  /* ---------------- 写入 ---------------- */

  async update(input: UpdateIntegrationInput) {
    await this.ensureConfig();

    const data = {
      ...(input.miniappAppId !== undefined
        ? { miniappAppId: this.text(input.miniappAppId, 64) }
        : {}),
      ...(input.miniappAppSecret !== undefined
        ? { miniappAppSecret: this.appSecret(input.miniappAppSecret) }
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
      ...(input.wechatPayPublicKeyId !== undefined
        ? { wechatPayPublicKeyId: this.text(input.wechatPayPublicKeyId, 64) }
        : {}),
      ...(input.subscribeTemplateIds !== undefined
        ? {
            subscribeTemplateIds: {
              orderPaid: this.text(input.subscribeTemplateIds.orderPaid ?? '', 64),
              orderShipped: this.text(input.subscribeTemplateIds.orderShipped ?? '', 64),
              refundResult: this.text(input.subscribeTemplateIds.refundResult ?? '', 64),
              pickupReady: this.text(input.subscribeTemplateIds.pickupReady ?? '', 64),
              pickupExpiring: this.text(input.subscribeTemplateIds.pickupExpiring ?? '', 64),
              deliveryAccepted: this.text(
                input.subscribeTemplateIds.deliveryAccepted ?? '',
                64,
              ),
              deliveryDone: this.text(input.subscribeTemplateIds.deliveryDone ?? '', 64),
            },
          }
        : {}),
      ...(input.subscribeTemplateFields !== undefined
        ? { subscribeTemplateFields: this.templateFields(input.subscribeTemplateFields) }
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
    // APIv3 密钥是 32 位字母数字，避免误传私钥文件
    if (field === 'wechatPayApiV3Key') {
      if (!/^[A-Za-z0-9]{32}$/.test(buffer.toString('utf8').trim())) {
        throw new BadRequestException(
          `${spec.label}应为 32 位字母数字，请确认上传的不是密钥文件`,
        );
      }
    }
    if (field === 'wechatPayPublicKey') {
      if (!buffer.toString('utf8').includes('BEGIN PUBLIC KEY')) {
        throw new BadRequestException(`${spec.label}应为 PEM 格式（-----BEGIN PUBLIC KEY-----）`);
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
      miniappUploadKeyFile: string | null;
      wechatPayApiV3KeyFile: string | null;
      wechatPayPrivateKeyFile: string | null;
      wechatPayPublicKeyFile: string | null;
    },
    field: SecretField,
  ): string | null {
    if (field === 'miniappUploadKey') return config.miniappUploadKeyFile;
    if (field === 'wechatPayApiV3Key') return config.wechatPayApiV3KeyFile;
    if (field === 'wechatPayPublicKey') return config.wechatPayPublicKeyFile;
    return config.wechatPayPrivateKeyFile;
  }

  private fileColumns(field: string, file: string, name: string) {
    if (field === 'miniappUploadKey') {
      return { miniappUploadKeyFile: file, miniappUploadKeyName: name };
    }
    if (field === 'wechatPayApiV3Key') {
      return { wechatPayApiV3KeyFile: file, wechatPayApiV3KeyName: name };
    }
    if (field === 'wechatPayPublicKey') {
      return { wechatPayPublicKeyFile: file, wechatPayPublicKeyName: name };
    }
    return { wechatPayPrivateKeyFile: file, wechatPayPrivateKeyName: name };
  }

  private clearColumns(field: string) {
    if (field === 'miniappUploadKey') {
      return { miniappUploadKeyFile: null, miniappUploadKeyName: null };
    }
    if (field === 'wechatPayApiV3Key') {
      return { wechatPayApiV3KeyFile: null, wechatPayApiV3KeyName: null };
    }
    if (field === 'wechatPayPublicKey') {
      return { wechatPayPublicKeyFile: null, wechatPayPublicKeyName: null };
    }
    return { wechatPayPrivateKeyFile: null, wechatPayPrivateKeyName: null };
  }

  /** AppSecret 直接录入：空字符串表示清除，否则必须是 32 位字母数字 */
  private appSecret(value: string): string | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return null;
    if (!/^[A-Za-z0-9]{32}$/.test(trimmed)) {
      throw new BadRequestException('小程序 AppSecret 必须是 32 位字母数字');
    }
    return trimmed;
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

  /** 校验模板字段映射：场景固定、字段名为微信模板键、值为变量名 */
  private templateFields(
    input: Record<string, Record<string, string>>,
  ): Record<string, Record<string, string>> {
    const scenes = ['orderPaid', 'orderShipped', 'refundResult'] as const;
    const out: Record<string, Record<string, string>> = {};
    for (const scene of scenes) {
      const map = input[scene];
      if (map === undefined) continue;
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new BadRequestException(`${scene} 模板字段映射必须是对象`);
      }
      out[scene] = {};
      for (const [key, value] of Object.entries(map)) {
        if (!/^[A-Za-z0-9_]{1,32}$/.test(key)) {
          throw new BadRequestException(`模板字段名不合法：${key}`);
        }
        if (typeof value !== 'string' || value.length > 64) {
          throw new BadRequestException(`模板字段 ${key} 的变量名不合法`);
        }
        out[scene][key] = value.trim();
      }
    }
    return out;
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
