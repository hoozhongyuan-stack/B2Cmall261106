import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  randomBytes,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';

import type {
  WechatPayConfig,
  WechatPayEncryptedResource,
  WechatPayJsapiParams,
} from './wechat-pay.config';

const BASE_URL = 'https://api.mch.weixin.qq.com';
/** 平台证书缓存 12 小时，证书轮换后自动重新拉取 */
const CERT_TTL_MS = 12 * 60 * 60 * 1000;
/** 回调时间戳允许偏差 5 分钟，防重放 */
const MAX_CLOCK_SKEW_SECONDS = 300;

interface CertificateItem {
  serial_no: string;
  encrypt_certificate: WechatPayEncryptedResource;
}

const platformKeyCache = new Map<string, { key: KeyObject; expiresAt: number }>();

/** 统一的头部读取：兼容 Node 的小写头与测试里的大小写混写 */
function header(headers: Record<string, string | undefined>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value) return value;
  }
  return '';
}

export class WechatPayClient {
  private readonly privateKey: KeyObject;

  constructor(private readonly config: WechatPayConfig) {
    this.privateKey = createPrivateKey(config.privateKeyPem);
  }

  /**
   * JSAPI 下单并生成小程序可调起的支付参数。
   * 文档：POST /v3/pay/transactions/jsapi
   */
  async createJsapiPayment(input: {
    outTradeNo: string;
    description: string;
    amountCents: number;
    openid: string;
  }): Promise<{ prepayId: string; payParams: WechatPayJsapiParams }> {
    const res = await this.request<{ prepay_id: string }>('POST', '/v3/pay/transactions/jsapi', {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: this.config.notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
      payer: { openid: input.openid },
    });
    if (!res.prepay_id) {
      throw new BadGatewayException('微信支付未返回 prepay_id');
    }
    return { prepayId: res.prepay_id, payParams: this.buildPayParams(res.prepay_id) };
  }

  /** 申请退款：优先使用微信交易号，兼容商户订单号 */
  async refund(input: {
    refundNo: string;
    outTradeNo?: string;
    transactionId?: string;
    amountCents: number;
    totalCents: number;
    reason?: string;
  }): Promise<{ refundId: string; status: string; raw: unknown }> {
    if (!input.transactionId && !input.outTradeNo) {
      throw new BadRequestException('微信退款需要交易号或商户订单号');
    }
    const payload = {
      ...(input.transactionId
        ? { transaction_id: input.transactionId }
        : { out_trade_no: input.outTradeNo }),
      out_refund_no: input.refundNo,
      ...(input.reason ? { reason: input.reason.slice(0, 80) } : {}),
      amount: { refund: input.amountCents, total: input.totalCents, currency: 'CNY' },
    };
    const res = await this.request<{ refund_id: string; status: string }>(
      'POST',
      '/v3/refund/domestic/refunds',
      payload,
    );
    return { refundId: res.refund_id ?? '', status: res.status ?? '', raw: res };
  }

  /** 查询退款：GET /v3/refund/domestic/refunds/{out_refund_no} */
  async queryRefund(refundNo: string): Promise<{ refundId: string; status: string; raw: unknown }> {
    const res = await this.request<{ refund_id?: string; status?: string }>(
      'GET',
      `/v3/refund/domestic/refunds/${encodeURIComponent(refundNo)}`,
    );
    return { refundId: res.refund_id ?? '', status: res.status ?? '', raw: res };
  }

  /**
   * 回调验签 + 解密 resource。
   * 验签报文：timestamp\nnonce\nrawBody\n
   */
  async verifyNotification(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<Record<string, unknown>> {
    const timestamp = header(headers, 'wechatpay-timestamp');
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!timestamp || !Number.isFinite(skew) || skew > MAX_CLOCK_SKEW_SECONDS) {
      throw new BadRequestException('微信支付回调时间戳无效');
    }

    await this.verifySignedMessage(headers, rawBody);

    let body: { resource?: WechatPayEncryptedResource };
    try {
      body = JSON.parse(rawBody) as { resource?: WechatPayEncryptedResource };
    } catch {
      throw new BadRequestException('微信支付回调报文不是合法 JSON');
    }
    if (!body.resource) throw new BadRequestException('微信支付回调缺少 resource');
    return this.decryptJson<Record<string, unknown>>(body.resource);
  }

  /* ---------------- 内部实现 ---------------- */

  private authorization(method: string, path: string, body: string): string {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
    return (
      'WECHATPAY2-SHA256-RSA2048 ' +
      `mchid="${this.config.mchId}",` +
      `nonce_str="${nonce}",` +
      `signature="${signature}",` +
      `timestamp="${timestamp}",` +
      `serial_no="${this.config.certSerial}"`
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    options: { skipVerify?: boolean } = {},
  ): Promise<T> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: this.authorization(method, path, body),
        Accept: 'application/json',
        // 微信支付 /v3/certificates 要求显式 Accept-Language，缺失会返回 406
        'Accept-Language': 'zh-CN',
        'Content-Type': 'application/json',
        'User-Agent': 'shanye-mall/1.0',
      },
      body: body || undefined,
    });

    const text = await res.text();
    const headers = Object.fromEntries(res.headers.entries()) as Record<string, string>;

    if (!options.skipVerify && headers['wechatpay-signature']) {
      await this.verifySignedMessage(headers, text);
    }

    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { code?: string; message?: string };
        detail = [parsed.code, parsed.message].filter(Boolean).join(' ') || text;
      } catch {
        /* 非 JSON 错误体直接使用原文 */
      }
      throw new BadGatewayException(
        `微信支付接口失败（${res.status}）：${detail || '无响应体'}`,
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  private async verifySignedMessage(
    headers: Record<string, string | undefined>,
    body: string,
  ): Promise<void> {
    const timestamp = header(headers, 'wechatpay-timestamp');
    const nonce = header(headers, 'wechatpay-nonce');
    const signature = header(headers, 'wechatpay-signature');
    const serial = header(headers, 'wechatpay-serial');
    if (!timestamp || !nonce || !signature || !serial) {
      throw new BadRequestException('微信支付报文缺少签名头');
    }

    const publicKey = await this.resolveWechatPublicKey(serial);
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const ok = createVerify('RSA-SHA256')
      .update(message)
      .verify(publicKey, signature, 'base64');
    if (!ok) throw new BadRequestException('微信支付报文验签失败');
  }

  /**
   * 公钥模式直接用后台配置的公钥；平台证书模式拉取 /v3/certificates 并按 serial 命中。
   */
  private async resolveWechatPublicKey(serial: string): Promise<KeyObject> {
    if (serial.startsWith('PUB_KEY_ID_')) {
      if (!this.config.publicKeyId || !this.config.publicKeyPem) {
        throw new BadRequestException(
          '收到微信支付公钥签名，但集成配置未上传微信支付公钥或未填写公钥 ID',
        );
      }
      if (this.config.publicKeyId !== serial) {
        throw new BadRequestException(`微信支付公钥 ID 不匹配：${serial}`);
      }
      return createPublicKey(this.config.publicKeyPem);
    }

    const cacheKey = `${this.config.mchId}:${serial}`;
    const cached = platformKeyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.key;

    const certs = await this.request<{ data?: CertificateItem[] }>(
      'GET',
      '/v3/certificates',
      undefined,
      { skipVerify: true },
    );
    const expiresAt = Date.now() + CERT_TTL_MS;
    for (const item of certs.data ?? []) {
      const pem = this.decryptBuffer(item.encrypt_certificate).toString('utf8');
      const key = new X509Certificate(pem).publicKey;
      platformKeyCache.set(`${this.config.mchId}:${item.serial_no}`, { key, expiresAt });
    }

    const refreshed = platformKeyCache.get(cacheKey);
    if (!refreshed) {
      throw new BadRequestException(
        `未找到序列号为 ${serial} 的微信支付平台证书；如为公钥模式请配置微信支付公钥`,
      );
    }
    return refreshed.key;
  }

  private decryptJson<T>(resource: WechatPayEncryptedResource): T {
    return JSON.parse(this.decryptBuffer(resource).toString('utf8')) as T;
  }

  /** AES-256-GCM：密文末 16 字节为 auth tag */
  private decryptBuffer(resource: WechatPayEncryptedResource): Buffer {
    const data = Buffer.from(resource.ciphertext, 'base64');
    if (data.length <= 16) throw new BadRequestException('微信支付加密报文长度不合法');

    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(data.subarray(data.length - 16));
    decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  }

  private buildPayParams(prepayId: string): WechatPayJsapiParams {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(16).toString('hex');
    const pkg = `prepay_id=${prepayId}`;
    const message = `${this.config.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
    const paySign = createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
    return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
  }
}
