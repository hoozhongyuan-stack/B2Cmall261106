import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/password';
import { buildProductSearchText } from '../src/common/search-text';

const prisma = new PrismaClient();

const PRODUCTS = [
  {
    title: '勐海古树普洱 2019',
    subtitle: '357g · 古树春料',
    category: '茶',
    price: 26800,
    origin: 32800,
    stock: 86,
    image: 'products/tea-01.jpg',
    sort: 1,
    spec: { 包装: '357g 单饼' },
  },
  {
    title: '云南小粒咖啡 日晒',
    subtitle: '250g · 中浅烘',
    category: '咖啡',
    price: 9800,
    origin: 12800,
    stock: 12,
    image: 'products/coffee-01.jpg',
    sort: 2,
    spec: { 规格: '250g / 袋' },
  },
  {
    title: '高山野蜂蜜',
    subtitle: '500g · 波美 42°',
    category: '蜂蜜',
    price: 12800,
    origin: null,
    stock: 54,
    image: 'products/honey-01.jpg',
    sort: 3,
    spec: { 规格: '500g / 瓶' },
  },
  {
    title: '手作粗陶公道杯',
    subtitle: '单只 · 柴烧落灰',
    category: '器皿',
    price: 8600,
    origin: null,
    stock: 0,
    image: 'products/clay-01.jpg',
    sort: 4,
    spec: { 规格: '单只' },
  },
  {
    title: '亚麻桌旗',
    subtitle: '35 × 180cm · 原色',
    category: '织物',
    price: 5900,
    origin: null,
    stock: 120,
    image: 'products/linen-01.jpg',
    sort: 5,
    spec: { 尺寸: '35 × 180cm' },
  },
  {
    title: '香格里拉松茸干',
    subtitle: '100g · 自然晒干',
    category: '调味',
    price: 19800,
    origin: null,
    stock: 36,
    image: 'products/mushroom-01.jpg',
    sort: 6,
    spec: { 规格: '100g / 袋' },
  },
];

async function main(): Promise<void> {
  console.log('开始写入种子数据…');

  await prisma.shopConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      shopName: '山野',
      intro: '云南山野风物选品店，只做当季、少量、可溯源的东西。',
      servicePhone: '400-800-1234',
      freeThresholdCents: 9900,
      flatFreightCents: 1000,
      payTimeoutMinutes: 15,
      afterSaleDays: 7,
      autoConfirmDays: 10,
    },
  });

  // 集成参数：开发阶段先用 mock 支付；AppSecret 由后台上传，不写进代码
  await prisma.integrationConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      miniappAppId: 'wx04619aa796c2188f',
      paymentProvider: 'mock',
    },
  });

  await prisma.shippingRegionException.createMany({
    data: [
      { regionName: '新疆 / 西藏', freightCents: 1800 },
      { regionName: '内蒙古 / 青海', freightCents: 1200 },
    ],
    skipDuplicates: true,
  });

  // 演示用角色：正式环境可在「账号 → 角色」中自由调整或删除
  const defaultRoles = [
    {
      name: '商品运营',
      description: '商品、营销、装修与门店运营',
      permissions: [
        'aftersale.view', 'analytics.view', 'asset.manage', 'asset.view', 'category.manage', 'category.view', 'coupon.edit', 'coupon.view', 'customer.edit', 'customer.view', 'dashboard.view', 'delivery.manage', 'express.manage', 'express.view', 'level.manage', 'level.view', 'log.view', 'membercard.manage', 'membercard.view', 'micropage.manage', 'micropage.view', 'miniapp.view', 'notification.manage', 'order.refund', 'order.view', 'pickup.verify', 'points.manage', 'points.view', 'popupad.manage', 'popupad.view', 'product.edit', 'product.stock', 'product.view', 'promotion.manage', 'promotion.view', 'review.manage', 'store.edit', 'store.view', 'system.view', 'tabbar.manage', 'tabbar.view', 'tag.manage', 'tag.view', 'usertag.manage', 'usertag.view', 'integration.view', 'shop.view', 'freight.manage', 'pointsmall.manage', 'pointsmall.view', 'circle.audit', 'circle.manage', 'circle.view',
      ],
    },
    {
      name: '客服',
      description: '订单查看、售后审核与客户服务',
      permissions: [
        'aftersale.audit', 'aftersale.view', 'analytics.view', 'category.view', 'coupon.view', 'customer.edit', 'customer.view', 'dashboard.view', 'delivery.manage', 'express.view', 'level.view', 'log.view', 'membercard.view', 'order.edit', 'order.refund', 'order.view', 'pickup.verify', 'points.view', 'product.stock', 'product.view', 'promotion.view', 'review.manage', 'store.view', 'tag.view', 'usertag.view', 'asset.view', 'integration.view', 'micropage.view', 'popupad.view', 'shop.view', 'tabbar.view', 'freight.manage', 'pointsmall.view', 'circle.audit', 'circle.view',
      ],
    },
    {
      name: '仓储',
      description: '发货、库存、核销与同城配送',
      permissions: [
        'aftersale.audit', 'aftersale.view', 'dashboard.view', 'delivery.manage', 'express.manage', 'express.view', 'order.ship', 'order.view', 'pickup.verify', 'product.stock', 'product.view', 'store.view', 'asset.view', 'integration.view', 'shop.view', 'freight.manage',
      ],
    },
  ];
  for (const role of defaultRoles) {
    const exists = await prisma.adminRoleDef.findUnique({
      where: { name: role.name },
      select: { id: true },
    });
    if (!exists) await prisma.adminRoleDef.create({ data: role });
  }

  const roleIdByName = new Map(
    (await prisma.adminRoleDef.findMany({ select: { id: true, name: true } })).map((role) => [
      role.name,
      role.id,
    ]),
  );

  // 超级管理员 + 三个演示角色账号
  const admins = [
    { account: 'admin@shanye.com', name: '王管理员', isSuper: true, roleName: null, pwd: 'admin123' },
    { account: 'ops@shanye.com', name: '小林', isSuper: false, roleName: '商品运营', pwd: 'ops12345' },
    { account: 'cs@shanye.com', name: '小周', isSuper: false, roleName: '客服', pwd: 'cs123456' },
    { account: 'wms@shanye.com', name: '老陈', isSuper: false, roleName: '仓储', pwd: 'wms12345' },
  ];
  for (const a of admins) {
    const roleId = a.roleName ? roleIdByName.get(a.roleName) ?? null : null;
    await prisma.adminUser.upsert({
      where: { account: a.account },
      update: { displayName: a.name, isSuper: a.isSuper, roleId },
      create: {
        account: a.account,
        displayName: a.name,
        isSuper: a.isSuper,
        roleId,
        passwordHash: hashPassword(a.pwd),
      },
    });
  }

  const levels = [
    { name: '访客', thresholdCents: 0, discountRate: 1, sort: 1 },
    { name: '山民', thresholdCents: 50000, discountRate: 0.98, sort: 2 },
    { name: '常客', thresholdCents: 200000, discountRate: 0.95, sort: 3 },
  ];
  const existingLevel = await prisma.memberLevel.count();
  if (!existingLevel) await prisma.memberLevel.createMany({ data: levels });

  const categories: Record<string, string> = {};
  for (const [i, name] of ['茶', '咖啡', '蜂蜜', '器皿', '织物', '调味'].entries()) {
    const c = await prisma.category.create({ data: { name, sort: i + 1 } });
    categories[name] = c.id;
  }

  for (const p of PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        title: p.title,
        subtitle: p.subtitle,
        categoryId: categories[p.category],
        searchText: buildProductSearchText({
          title: p.title,
          subtitle: p.subtitle,
          categoryName: p.category,
        }),
        status: 'ON_SALE',
        mainImageKey: p.image,
        priceMinCents: p.price,
        priceMaxCents: p.price,
        soldCount: 0,
        sort: p.sort,
        skus: {
          create: {
            code: `SKU-${p.sort.toString().padStart(4, '0')}`,
            specJson: p.spec,
            priceCents: p.price,
            originCents: p.origin ?? undefined,
            stock: p.stock,
            status: 'ON_SALE',
          },
        },
      },
    });
    console.log(`商品已写入：${product.title}`);
  }

  const user = await prisma.user.create({
    data: {
      openid: 'dev_seed_user',
      nickname: '王先生',
      phone: '13800006621',
      // 累计消费与等级一致：60000 分已达到「山民」门槛
      totalSpentCents: 60000,
      levelId: (await prisma.memberLevel.findFirst({ where: { name: '山民' } }))?.id,
    },
  });
  await prisma.address.create({
    data: {
      userId: user.id,
      receiver: '王先生',
      phone: '13800006621',
      region: '云南省昆明市五华区',
      detail: '文林街 12 号 3 单元 502',
      isDefault: true,
    },
  });

  const coupon = await prisma.coupon.create({
    data: {
      name: '全场满 400 减 30',
      type: 'THRESHOLD',
      thresholdCents: 40000,
      faceValueCents: 3000,
      total: 1000,
      perLimit: 1,
      channel: 'MINIAPP',
      startAt: new Date('2026-11-01T00:00:00+08:00'),
      endAt: new Date('2026-11-30T23:59:59+08:00'),
    },
  });
  await prisma.couponClaim.create({
    data: {
      couponId: coupon.id,
      userId: user.id,
      status: 'UNUSED',
      expiresAt: new Date('2026-11-30T23:59:59+08:00'),
    },
  });
  // 领取数与发放记录保持一致
  await prisma.coupon.update({ where: { id: coupon.id }, data: { claimed: { increment: 1 } } });

  console.log('种子数据完成。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
