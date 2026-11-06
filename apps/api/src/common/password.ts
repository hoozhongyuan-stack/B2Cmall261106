import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

/** scrypt$salt$hash —— 纯 Node 实现，避免引入需要编译的原生依赖 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(plain, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** 生成订单号：SY + 年月日时分秒 + 4 位随机，便于客服口述与检索 */
export function generateOrderNo(now = new Date()): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  const stamp =
    now.getFullYear() +
    p(now.getMonth() + 1) +
    p(now.getDate()) +
    p(now.getHours()) +
    p(now.getMinutes()) +
    p(now.getSeconds());
  const rand = randomBytes(2).toString('hex').toUpperCase();
  return `SY${stamp}${rand}`;
}

/** 幂等键签名，用于把客户端 key 与用户绑定，防止跨用户重放 */
export function signIdempotencyKey(userId: string, key: string, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}:${key}`).digest('hex');
}
