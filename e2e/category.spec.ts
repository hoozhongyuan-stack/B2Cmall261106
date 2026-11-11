import { expect, test } from '@playwright/test';

const H5 = 'http://127.0.0.1:8080';

test('分类页：搜索、分类图标与综合/销量/价格排序', async ({ page }) => {
  await page.goto(`${H5}/#/pages/category/index`);

  await expect(page.locator('.cat-search')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cat-chip').first()).toBeVisible();
  await expect(page.locator('.cat-chip-image').first()).toBeVisible();
  await expect(page.locator('.cat-main .card').first()).toBeVisible();

  // 销量排序
  await page.getByText('销量', { exact: true }).click();
  await expect(page.locator('.cat-sort-item--on')).toContainText('销量');

  // 价格排序：首次升序，再点降序
  await page.getByText('价格', { exact: true }).click();
  await expect(page.locator('.cat-sort-item--on')).toContainText('↑');
  await page.getByText('价格', { exact: true }).click();
  await expect(page.locator('.cat-sort-item--on')).toContainText('↓');

  // 搜索跳转
  await page.locator('.cat-search-input input').fill('普洱');
  await page.locator('.cat-search-btn').click();
  await expect(page).toHaveURL(/pages\/search\/index\?keyword=/);
});
