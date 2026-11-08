import { PrismaClient } from '@prisma/client';

import { buildProductSearchText } from '../src/common/search-text';

/**
 * 历史商品搜索文本回填。
 * 默认只处理 searchText 为空的历史数据；`--all` 会重算全部商品。
 * 结束后校验空 searchText 数量，不为 0 时以非 0 退出码结束（便于 CI / 部署卡口）。
 */
const prisma = new PrismaClient();
const REBUILD_ALL = process.argv.includes('--all');
const BATCH_SIZE = 200;

async function main(): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const products = await prisma.product.findMany({
      where: {
        ...(REBUILD_ALL ? {} : { searchText: '' }),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        title: true,
        subtitle: true,
        searchText: true,
        category: { select: { name: true } },
        tags: { select: { name: true } },
      },
    });
    if (products.length === 0) break;

    for (const product of products) {
      scanned += 1;
      const searchText = buildProductSearchText({
        title: product.title,
        subtitle: product.subtitle,
        categoryName: product.category.name,
        tags: product.tags.map((tag) => tag.name),
      });
      if (searchText === product.searchText) continue;
      await prisma.product.update({ where: { id: product.id }, data: { searchText } });
      updated += 1;
    }

    cursor = products[products.length - 1].id;
  }

  const remaining = await prisma.product.count({ where: { searchText: '' } });
  console.log(
    `回填完成：扫描 ${scanned} 个商品，更新 ${updated} 个，剩余空 searchText ${remaining} 个。`,
  );
  if (remaining > 0) {
    console.error('存在未回填搜索文本的商品，请检查后重试。');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
