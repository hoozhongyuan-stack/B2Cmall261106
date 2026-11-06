import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/password';

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
    update: {
      miniappAppId: 'wx04619aa796c2188f',
    },
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
      miniappAppId: 'wx04619aa796c2188f',
    },
  });

  await prisma.shippingRegionException.createMany({
    data: [
      { regionName: '新疆 / 西藏', freightCents: 1800 },
      { regionName: '内蒙古 / 青海', freightCents: 1200 },
    ],
    skipDuplicates: true,
  });

  // 四个角色各一个账号，用于权限验收
  const admins = [
    { account: 'admin@shanye.com', name: '王管理员', role: 'SUPER' as const, pwd: 'admin123' },
    { account: 'ops@shanye.com', name: '小林', role: 'OPS' as const, pwd: 'ops12345' },
    { account: 'cs@shanye.com', name: '小周', role: 'CS' as const, pwd: 'cs123456' },
    { account: 'wms@shanye.com', name: '老陈', role: 'WMS' as const, pwd: 'wms12345' },
  ];
  for (const a of admins) {
    await prisma.adminUser.upsert({
      where: { account: a.account },
      update: { displayName: a.name, role: a.role },
      create: {
        account: a.account,
        displayName: a.name,
        role: a.role,
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
