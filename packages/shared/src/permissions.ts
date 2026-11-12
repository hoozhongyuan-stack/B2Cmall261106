/**
 * 后台权限目录：后端鉴权、角色页面、迁移脚本共用同一份定义。
 * key 规范：<模块>.<动作>；写权限需同时具备对应查看权限（前端勾选时自动级联）。
 */
export const PERMISSION_GROUPS = [
  {
    key: 'data',
    name: '数据',
    items: [
      { key: 'dashboard.view', name: '数据概览' },
      { key: 'analytics.view', name: '经营看板' },
    ],
  },
  {
    key: 'product',
    name: '商品',
    items: [
      { key: 'product.view', name: '商品查看' },
      { key: 'product.edit', name: '商品编辑 / 上下架' },
      { key: 'product.stock', name: '规格库存' },
      { key: 'category.view', name: '分类查看' },
      { key: 'category.manage', name: '分类管理' },
      { key: 'tag.view', name: '标签查看' },
      { key: 'tag.manage', name: '标签管理' },
      { key: 'asset.view', name: '素材查看' },
      { key: 'asset.manage', name: '素材管理' },
    ],
  },
  {
    key: 'order',
    name: '交易',
    items: [
      { key: 'order.view', name: '订单查看' },
      { key: 'order.ship', name: '发货 / 批量发货' },
      { key: 'order.refund', name: '退款处理' },
      { key: 'order.edit', name: '订单备注 / 关闭超时订单' },
      { key: 'aftersale.view', name: '售后查看' },
      { key: 'aftersale.audit', name: '售后审核 / 确认收货' },
      { key: 'review.manage', name: '评价管理' },
    ],
  },
  {
    key: 'customer',
    name: '客户',
    items: [
      { key: 'customer.view', name: '客户查看' },
      { key: 'customer.edit', name: '客户编辑 / 打标签 / 调积分' },
      { key: 'usertag.view', name: '用户标签查看' },
      { key: 'usertag.manage', name: '用户标签管理' },
      { key: 'level.view', name: '等级规则查看' },
      { key: 'level.manage', name: '等级规则管理' },
      { key: 'membercard.view', name: '会员卡与储值查看' },
      { key: 'membercard.manage', name: '会员卡与储值管理' },
      { key: 'points.view', name: '积分规则查看' },
      { key: 'points.manage', name: '积分规则管理' },
    ],
  },
  {
    key: 'marketing',
    name: '营销',
    items: [
      { key: 'coupon.view', name: '优惠券查看' },
      { key: 'coupon.edit', name: '优惠券创建 / 编辑 / 发放' },
      { key: 'promotion.view', name: '满减与秒杀查看' },
      { key: 'promotion.manage', name: '满减与秒杀管理' },
      { key: 'pointsmall.view', name: '积分商城查看' },
      { key: 'pointsmall.manage', name: '积分商城商品管理' },
    ],
  },
  {
    key: 'fulfillment',
    name: '门店履约',
    items: [
      { key: 'store.view', name: '门店查看' },
      { key: 'store.edit', name: '门店新建 / 编辑 / 停用' },
      { key: 'pickup.verify', name: '自提核销' },
      { key: 'delivery.manage', name: '同城配送' },
    ],
  },
  {
    key: 'decoration',
    name: '装修',
    items: [
      { key: 'micropage.view', name: '页面装修查看' },
      { key: 'micropage.manage', name: '页面装修管理' },
      { key: 'tabbar.view', name: '底部导航查看' },
      { key: 'tabbar.manage', name: '底部导航管理' },
      { key: 'popupad.view', name: '弹窗广告查看' },
      { key: 'popupad.manage', name: '弹窗广告管理' },
    ],
  },
  {
    key: 'settings',
    name: '设置',
    items: [
      { key: 'shop.view', name: '店铺信息查看' },
      { key: 'shop.manage', name: '店铺信息管理' },
      { key: 'integration.view', name: '小程序与支付查看' },
      { key: 'integration.manage', name: '小程序与支付管理' },
      { key: 'notification.manage', name: '订阅消息测试 / 重试' },
      { key: 'miniapp.view', name: '小程序发布查看' },
      { key: 'miniapp.release', name: '小程序发布管理' },
      { key: 'freight.manage', name: '运费模板' },
      { key: 'express.view', name: '物流公司查看' },
      { key: 'express.manage', name: '物流公司管理' },
      { key: 'system.view', name: '系统状态' },
    ],
  },
  {
    key: 'account',
    name: '账号',
    items: [
      { key: 'account.view', name: '子账号查看' },
      { key: 'account.manage', name: '子账号管理' },
      { key: 'role.view', name: '角色查看' },
      { key: 'role.manage', name: '角色管理' },
      { key: 'log.view', name: '操作日志' },
    ],
  },
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];
export type PermissionKey = PermissionGroup['items'][number]['key'];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((group) =>
  group.items.map((item) => item.key),
);

const PERMISSION_NAME = new Map<string, string>(ALL_PERMISSIONS.map((key) => [key, key]));

for (const group of PERMISSION_GROUPS) {
  for (const item of group.items) {
    PERMISSION_NAME.set(item.key, item.name);
  }
}

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_NAME.has(value);
}

export function permissionName(key: string): string {
  return PERMISSION_NAME.get(key) ?? key;
}

/** 写权限依赖的查看权限：勾选写权限时自动补上 */
export const PERMISSION_DEPENDENCIES: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'product.edit': ['product.view'],
  'product.stock': ['product.view'],
  'category.manage': ['category.view'],
  'tag.manage': ['tag.view'],
  'asset.manage': ['asset.view'],
  'order.ship': ['order.view'],
  'order.refund': ['order.view'],
  'order.edit': ['order.view'],
  'aftersale.audit': ['aftersale.view'],
  'customer.edit': ['customer.view'],
  'usertag.manage': ['usertag.view'],
  'level.manage': ['level.view'],
  'membercard.manage': ['membercard.view'],
  'points.manage': ['points.view'],
  'coupon.edit': ['coupon.view'],
  'promotion.manage': ['promotion.view'],
  'pointsmall.manage': ['pointsmall.view'],
  'store.edit': ['store.view'],
  'micropage.manage': ['micropage.view'],
  'tabbar.manage': ['tabbar.view'],
  'popupad.manage': ['popupad.view'],
  'shop.manage': ['shop.view'],
  'integration.manage': ['integration.view'],
  'miniapp.release': ['miniapp.view'],
  'express.manage': ['express.view'],
};
