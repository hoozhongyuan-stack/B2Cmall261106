import { PrismaClient } from '@prisma/client';

import { buildProductSearchText } from '../src/common/search-text';

/**
 * 本地搜索性能基准数据：1000 个在售商品 × 10 个 SKU = 1 万 SKU。
 * 标题覆盖常用两字中文与拼音样本，价格/排序随机，不影响首页推荐（sort 从 9000 起）。
 *   pnpm --filter @shanye/api db:bench-seed    写入基准数据
 *   pnpm --filter @shanye/api db:bench-clean   清理基准数据
 */
const prisma = new PrismaClient();
const CLEAN = process.argv.includes('--clean');
const PRODUCT_COUNT = 1000;
const SKUS_PER_PRODUCT = 10;
const BATCH_SIZE = 50;
const CATEGORY_NAME = '基准测试';

/** 每个词都覆盖两类中文样本：两字召回与拼音首字母 */
const BASES = [
  '勐海古树普洱',
  '云南小粒咖啡',
  '高山野蜂蜜',
  '香格里拉松茸',
  '易武春茶',
  '临沧红茶',
  '诺邓火腿',
  '元阳红米',
  '建水紫陶',
  '宣威火腿',
  '普洱熟茶',
  '滇红金芽',
  '冰岛古树',
  '昔归普洱',
  '景迈山茶',
  '玫瑰花饼',
  '野生菌干',
  '山核桃',
  '古法黑糖',
  '农家腊肉',
];
const FLAVORS = ['春茶', '礼盒', '单饼', '袋装', '当季', '古法', '手作', '精选'];

async function clean(): Promise<void> {
  const category = await prisma.category.findFirst({ where: { name: CATEGORY_NAME } });
  if (!category) {
    console.log('未找到基准分类，无需清理。');
    return;
  }
  const products = await prisma.product.findMany({
    where: { categoryId: category.id },
    select: { id: true },
  });
  const productIds = products.map((item) => item.id);
  if (productIds.length) {
    await prisma.sku.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productTag.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.category.delete({ where: { id: category.id } });
  console.log(`已清理基准数据：${productIds.length} 个商品。`);
}

async function seed(): Promise<void> {
  const existing = await prisma.category.findFirst({ where: { name: CATEGORY_NAME } });
  const category =
    existing ??
    (await prisma.category.create({ data: { name: CATEGORY_NAME, sort: 99 } }));

  let created = 0;
  for (let start = 0; start < PRODUCT_COUNT; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, PRODUCT_COUNT);
    const jobs: Promise<unknown>[] = [];
    for (let index = start; index < end; index += 1) {
      const base = BASES[index % BASES.length];
      const flavor = FLAVORS[index % FLAVORS.length];
      const title = `${base} ${flavor} ${String(index + 1).padStart(4, '0')}`;
      const priceCents = 2000 + ((index * 137) % 48000);
      jobs.push(
        prisma.product.create({
          data: {
            title,
            subtitle: `${flavor} · 基准样本`,
            categoryId: category.id,
            searchText: buildProductSearchText({
              title,
              subtitle: flavor,
              categoryName: CATEGORY_NAME,
            }),
            status: 'ON_SALE',
            priceMinCents: priceCents,
            priceMaxCents: priceCents + 2000,
            soldCount: index % 300,
            sort: 9000 + index,
            skus: {
              create: Array.from({ length: SKUS_PER_PRODUCT }, (_, skuIndex) => ({
                code: `BENCH-${String(index + 1).padStart(4, '0')}-${skuIndex + 1}`,
                specJson: { 规格: `${skuIndex + 1} 号` },
                priceCents: priceCents + skuIndex * 100,
                stock: 100 + skuIndex,
                status: 'ON_SALE' as const,
              })),
            },
          },
        }),
      );
    }
    await Promise.all(jobs);
    created += jobs.length;
    if (created % 200 === 0 || created === PRODUCT_COUNT) {
      console.log(`已写入 ${created} 个商品 / ${created * SKUS_PER_PRODUCT} 个 SKU…`);
    }
  }
  console.log(`基准数据完成：${created} 个商品，${created * SKUS_PER_PRODUCT} 个 SKU。`);
}

(CLEAN ? clean() : seed())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
