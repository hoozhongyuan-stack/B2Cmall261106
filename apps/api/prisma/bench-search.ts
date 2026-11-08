import { PrismaClient } from '@prisma/client';

/**
 * 搜索性能与召回验收（需先写入基准数据并启动 API）：
 *   pnpm --filter @shanye/api db:bench-seed
 *   pnpm --filter @shanye/api search:bench
 * 验收线：P95 < 300ms；20 个两字中文样本召回 ≥ 95%；拼音全拼/首字母可召回。
 */
const API_BASE = process.env.SEARCH_BENCH_BASE ?? 'http://127.0.0.1:3000/api';
const ROUNDS_PER_KEYWORD = 10;
const P95_LIMIT_MS = 300;
const RECALL_LIMIT = 0.95;

/** 均为基准数据标题中出现过的两字中文样本 */
const KEYWORDS = [
  '普洱',
  '咖啡',
  '蜂蜜',
  '松茸',
  '春茶',
  '红茶',
  '火腿',
  '红米',
  '紫陶',
  '古树',
  '冰岛',
  '昔归',
  '景迈',
  '玫瑰',
  '菌干',
  '核桃',
  '黑糖',
  '腊肉',
  '滇红',
  '山茶',
];
const PINYIN_CASES = [
  { keyword: 'menghaigushupuer', label: '全拼' },
  { keyword: 'mhgs', label: '首字母' },
];

interface ProductPage {
  total: number;
}

async function search(keyword: string): Promise<{ total: number; ms: number }> {
  const startedAt = performance.now();
  const res = await fetch(
    `${API_BASE}/products?keyword=${encodeURIComponent(keyword)}&pageSize=20`,
  );
  const ms = performance.now() - startedAt;
  if (!res.ok) throw new Error(`搜索失败 ${keyword}：HTTP ${res.status}`);
  const body = (await res.json()) as { data?: ProductPage };
  return { total: body.data?.total ?? 0, ms };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1);
  return sorted[Math.max(index, 0)];
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const startedAt = new Date();

  try {
    // 预热：避免首次请求的编译/连接开销拉高 P95
    for (let index = 0; index < 10; index += 1) await search('普洱');

    const latencies: number[] = [];
    let recalled = 0;
    for (const keyword of KEYWORDS) {
      let hits = 0;
      for (let round = 0; round < ROUNDS_PER_KEYWORD; round += 1) {
        const { total, ms } = await search(keyword);
        latencies.push(ms);
        if (total > 0) hits += 1;
      }
      if (hits > 0) recalled += 1;
    }

    const pinyinResults: string[] = [];
    for (const item of PINYIN_CASES) {
      const { total } = await search(item.keyword);
      pinyinResults.push(`${item.label} ${item.keyword}: ${total} 件`);
      if (total === 0) throw new Error(`拼音${item.label}未召回：${item.keyword}`);
    }

    const recall = recalled / KEYWORDS.length;
    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const max = Math.max(...latencies);
    const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;

    console.log(`样本数：${latencies.length} 次搜索（${KEYWORDS.length} 词 × ${ROUNDS_PER_KEYWORD} 轮）`);
    console.log(`延迟：avg ${avg.toFixed(1)}ms / P50 ${p50.toFixed(1)}ms / P95 ${p95.toFixed(1)}ms / max ${max.toFixed(1)}ms`);
    console.log(`两字中文召回：${recalled}/${KEYWORDS.length} = ${(recall * 100).toFixed(0)}%`);
    console.log(`拼音召回：${pinyinResults.join('；')}`);

    const failures: string[] = [];
    if (p95 >= P95_LIMIT_MS) failures.push(`P95 ${p95.toFixed(1)}ms 超过 ${P95_LIMIT_MS}ms`);
    if (recall < RECALL_LIMIT) failures.push(`召回率 ${(recall * 100).toFixed(0)}% 低于 95%`);
    if (failures.length) {
      console.error(`验收失败：${failures.join('；')}`);
      process.exitCode = 1;
    } else {
      console.log('搜索性能与召回验收通过。');
    }
  } finally {
    // 清理本次压测写入的搜索日志，避免污染热词统计
    await prisma.searchLog.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
