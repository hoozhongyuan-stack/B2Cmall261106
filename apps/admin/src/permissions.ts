import type { PermissionKey } from '@shanye/shared/src/permissions';

/** 路由 → 权限：详情页继承上级查看权限，编辑页要求写权限 */
const ROUTES: [RegExp, PermissionKey][] = [
  [/^\/$/, 'dashboard.view'],
  [/^\/analytics/, 'analytics.view'],
  [/^\/products\/new$/, 'product.edit'],
  [/^\/products\/[^/]+\/edit$/, 'product.edit'],
  [/^\/products\/[^/]+\/stock$/, 'product.stock'],
  [/^\/products/, 'product.view'],
  [/^\/categories/, 'category.view'],
  [/^\/tags/, 'tag.view'],
  [/^\/orders\/batch-ship$/, 'order.ship'],
  [/^\/orders/, 'order.view'],
  [/^\/after-sales/, 'aftersale.view'],
  [/^\/reviews/, 'review.manage'],
  [/^\/customers/, 'customer.view'],
  [/^\/user-tags/, 'usertag.view'],
  [/^\/levels/, 'level.view'],
  [/^\/members\//, 'membercard.view'],
  [/^\/points-rules/, 'points.view'],
  [/^\/coupons\/new$/, 'coupon.edit'],
  [/^\/coupons\/[^/]+\/claims$/, 'coupon.view'],
  [/^\/coupons/, 'coupon.view'],
  [/^\/marketing\/(full-reduction|seckill)/, 'promotion.view'],
  [/^\/marketing\/points-mall/, 'pointsmall.view'],
  [/^\/settings\/stores\/new$/, 'store.edit'],
  [/^\/settings\/stores\/[^/]+\/edit$/, 'store.edit'],
  [/^\/settings\/stores/, 'store.view'],
  [/^\/fulfillment\/pickups/, 'pickup.verify'],
  [/^\/fulfillment\/deliveries/, 'delivery.manage'],
  [/^\/settings\/home\/tabbar$/, 'tabbar.view'],
  [/^\/settings\/home\/popup-ads$/, 'popupad.view'],
  [/^\/settings\/home\/[^/]+$/, 'micropage.manage'],
  [/^\/settings\/home/, 'micropage.view'],
  [/^\/assets/, 'asset.view'],
  [/^\/settings\/shop/, 'shop.view'],
  [/^\/settings\/integration/, 'integration.view'],
  [/^\/settings\/miniapp-release/, 'miniapp.view'],
  [/^\/settings\/freight/, 'freight.manage'],
  [/^\/settings\/system/, 'system.view'],
  [/^\/settings\/express/, 'express.view'],
  [/^\/accounts\/roles\/new$/, 'role.manage'],
  [/^\/accounts\/roles\/[^/]+\/edit$/, 'role.manage'],
  [/^\/accounts\/roles/, 'role.view'],
  [/^\/accounts/, 'account.view'],
  [/^\/logs/, 'log.view'],
];

export function requiredPermission(pathname: string): PermissionKey | null {
  const hit = ROUTES.find(([pattern]) => pattern.test(pathname));
  return hit?.[1] ?? null;
}
