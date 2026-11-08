import {
  createCipheriv,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WechatPayClient } from '../../src/modules/payment/wechat/wechat-pay.client';
import type { WechatPayConfig } from '../../src/modules/payment/wechat/wechat-pay.config';

const API_V3_KEY = '0123456789abcdef0123456789abcdef';

function rsaPair() {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey: String(pair.publicKey), privateKey: String(pair.privateKey) };
}

function makeConfig(
  overrides: Partial<WechatPayConfig> = {},
): { config: WechatPayConfig; merchantPublicKey: string } {
  const merchant = rsaPair();
  return {
    config: {
      appId: 'wx_test_appid',
      mchId: '1716944776',
      certSerial: 'MCH_SERIAL_001',
      notifyUrl: 'https://car.aition.art/api/payments/callback',
      apiV3Key: API_V3_KEY,
      privateKeyPem: merchant.privateKey,
      ...overrides,
    },
    merchantPublicKey: merchant.publicKey,
  };
}

function encryptResource(plain: string) {
  const nonce = 'abcdefghijkl';
  const associatedData = 'transaction';
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(API_V3_KEY, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    associated_data: associatedData,
    nonce,
    original_type: 'transaction',
  };
}

function signedHeaders(
  privateKey: string,
  body: string,
  serial: string,
  timestamp = Math.floor(Date.now() / 1000).toString(),
): Record<string, string> {
  const nonce = 'nonce_123456';
  const signature = createSign('RSA-SHA256')
    .update(`${timestamp}\n${nonce}\n${body}\n`)
    .sign(privateKey, 'base64');
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-serial': serial,
    'wechatpay-signature': signature,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WechatPayClient 支付回调', () => {
  it('公钥模式：验签通过并解密交易信息', async () => {
    const wechat = rsaPair();
    const { config } = makeConfig({
      publicKeyId: 'PUB_KEY_ID_123',
      publicKeyPem: wechat.publicKey,
    });
    const client = new WechatPayClient(config);

    const body = JSON.stringify({
      id: 'evt_001',
      event_type: 'TRANSACTION.SUCCESS',
      resource: encryptResource(
        JSON.stringify({
          out_trade_no: 'ORD20261107001A1B',
          transaction_id: '4200000000202611070001',
          trade_state: 'SUCCESS',
          amount: { total: 1990 },
          success_time: '2026-11-07T12:00:00+08:00',
        }),
      ),
    });

    const result = await client.verifyNotification(
      signedHeaders(wechat.privateKey, body, 'PUB_KEY_ID_123'),
      body,
    );

    expect(result.out_trade_no).toBe('ORD20261107001A1B');
    expect(result.trade_state).toBe('SUCCESS');
    expect((result.amount as { total: number }).total).toBe(1990);
  });

  it('报文被篡改时验签失败', async () => {
    const wechat = rsaPair();
    const { config } = makeConfig({
      publicKeyId: 'PUB_KEY_ID_123',
      publicKeyPem: wechat.publicKey,
    });
    const client = new WechatPayClient(config);
    const body = JSON.stringify({ resource: encryptResource('{"out_trade_no":"A"}') });
    const headers = signedHeaders(wechat.privateKey, body, 'PUB_KEY_ID_123');

    await expect(
      client.verifyNotification(headers, `${body} `),
    ).rejects.toThrow('验签失败');
  });

  it('时间戳超出 5 分钟拒绝处理', async () => {
    const wechat = rsaPair();
    const { config } = makeConfig({
      publicKeyId: 'PUB_KEY_ID_123',
      publicKeyPem: wechat.publicKey,
    });
    const client = new WechatPayClient(config);
    const body = JSON.stringify({ resource: encryptResource('{}') });
    const oldTimestamp = Math.floor(Date.now() / 1000 - 600).toString();

    await expect(
      client.verifyNotification(
        signedHeaders(wechat.privateKey, body, 'PUB_KEY_ID_123', oldTimestamp),
        body,
      ),
    ).rejects.toThrow('时间戳无效');
  });
});

describe('WechatPayClient 下单', () => {
  it('请求签名与小程序支付参数均可被商户公钥验证', async () => {
    const { config, merchantPublicKey } = makeConfig();
    const client = new WechatPayClient(config);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ prepay_id: 'wx201410272009395522657a690389285100' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.createJsapiPayment({
      outTradeNo: 'ORD20261107001A1B',
      description: '山野商城订单',
      amountCents: 1990,
      openid: 'openid_test',
    });

    expect(result.prepayId).toBe('wx201410272009395522657a690389285100');
    expect(result.payParams.signType).toBe('RSA');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi');

    const payload = JSON.parse(String(init.body)) as {
      out_trade_no: string;
      payer: { openid: string };
      amount: { total: number };
      notify_url: string;
    };
    expect(payload.out_trade_no).toBe('ORD20261107001A1B');
    expect(payload.payer.openid).toBe('openid_test');
    expect(payload.amount.total).toBe(1990);
    expect(payload.notify_url).toBe(config.notifyUrl);

    // 请求头签名
    const authorization = String(
      (init.headers as Record<string, string>).Authorization ?? '',
    );
    const field = (name: string) => authorization.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? '';
    const requestMessage = `POST\n/v3/pay/transactions/jsapi\n${field('timestamp')}\n${field('nonce_str')}\n${String(init.body)}\n`;
    expect(
      createVerify('RSA-SHA256')
        .update(requestMessage)
        .verify(merchantPublicKey, field('signature'), 'base64'),
    ).toBe(true);
    expect(field('mchid')).toBe(config.mchId);
    expect(field('serial_no')).toBe(config.certSerial);

    // 小程序调起参数签名
    const payMessage = `${config.appId}\n${result.payParams.timeStamp}\n${result.payParams.nonceStr}\n${result.payParams.package}\n`;
    expect(
      createVerify('RSA-SHA256')
        .update(payMessage)
        .verify(merchantPublicKey, result.payParams.paySign, 'base64'),
    ).toBe(true);
  });

  it('退款请求优先使用微信交易号', async () => {
    const { config } = makeConfig();
    const client = new WechatPayClient(config);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ refund_id: '50300000002026110700001', status: 'SUCCESS' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.refund({
      refundNo: 'RF202611070001',
      transactionId: '4200000000202611070001',
      amountCents: 1990,
      totalCents: 1990,
      reason: '不想要了',
    });

    expect(result).toMatchObject({ refundId: '50300000002026110700001', status: 'SUCCESS' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      transaction_id: string;
      out_refund_no: string;
      amount: { refund: number; total: number };
    };
    expect(payload.transaction_id).toBe('4200000000202611070001');
    expect(payload.out_refund_no).toBe('RF202611070001');
    expect(payload.amount).toEqual({ refund: 1990, total: 1990, currency: 'CNY' });
  });
});
