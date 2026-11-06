/**
 * 契约测试样例（R2 / R4）
 * 位置：apps/api/test/contract/order.spec.ts
 * 依赖：supertest · openapi-response-validator · yaml
 *
 * 目的：接口响应结构必须与仓库根目录 openapi.yaml 一致；
 *      同时校验「应付金额 = 商品 - 会员折扣 - 券 + 运费」，防止实现漂移。
 */
import request from 'supertest';
import { OpenApiResponseValidator } from 'openapi-response-validator';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from '../../src/app';

const spec = load(readFileSync(join(__dirname, '../../../../openapi.yaml'), 'utf8')) as any;

const validator = new OpenApiResponseValidator({
  responses: spec.paths['/orders'].post.responses,
  components: spec.components,
});

describe('POST /api/orders', () => {
  it('返回结构与 openapi.yaml 一致', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Idempotency-Key', 'contract-key-001')
      .send({
        addressId: 'addr_seed_1',
        items: [{ skuId: 'sku_seed_1', quantity: 1 }],
      })
      .expect(201);

    const errors = validator.validateResponse(201, res.body);
    if (errors) throw new Error(`契约不一致：${JSON.stringify(errors)}`);
  });

  it('应付金额等于五项明细运算结果', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Idempotency-Key', 'contract-key-002')
      .send({
        addressId: 'addr_seed_1',
        items: [{ skuId: 'sku_seed_1', quantity: 1 }],
      })
      .expect(201);

    const a = res.body.amount;
    expect(a.payableCents).toBe(
      a.goodsCents - a.memberDiscountCents - a.couponCents + a.freightCents,
    );
  });

  it('同一幂等键重复提交只产生一笔订单', async () => {
    const key = 'contract-key-003';
    const payload = {
      addressId: 'addr_seed_1',
      items: [{ skuId: 'sku_seed_1', quantity: 1 }],
    };

    const first = await request(app.getHttpServer())
      .post('/api/orders').set('Idempotency-Key', key).send(payload).expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/orders').set('Idempotency-Key', key).send(payload).expect(201);

    expect(second.body.orderNo).toBe(first.body.orderNo);
  });

  it('请求体出现 points 字段时直接拒绝（订单不支持积分抵扣）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Idempotency-Key', 'contract-key-004')
      .send({
        addressId: 'addr_seed_1',
        items: [{ skuId: 'sku_seed_1', quantity: 1 }],
        points: 100,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORDER_POINTS_NOT_SUPPORTED');
  });
});
