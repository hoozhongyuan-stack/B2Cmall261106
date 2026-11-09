import { Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';

import './stock.css';

interface StockRow {
  skuId: string;
  code: string;
  title: string;
  specText: string;
  priceCents: number;
  stock: number;
  reserved: number;
  available: number;
  safetyStock: number;
  warning: boolean;
  status: string;
}

interface StockResult {
  total: number;
  page: number;
  pageSize: number;
  warnings: number;
  items: StockRow[];
}

const PAGE_SIZE = 20;

export default function Page() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [onlyWarning, setOnlyWarning] = useState(router.params.warning === '1');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [warnings, setWarnings] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StockRow | null>(null);
  const [stockValue, setStockValue] = useState('');
  const [safetyValue, setSafetyValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (options: { page?: number; append?: boolean } = {}) => {
    const nextPage = options.page ?? 1;
    setLoading(true);
    try {
      const result = await api<StockResult>('/store-console/stock', {
        query: {
          keyword: appliedKeyword || undefined,
          warning: onlyWarning ? 1 : undefined,
          page: nextPage,
          pageSize: PAGE_SIZE,
        },
      });
      setRows(options.append ? [...rows, ...result.items] : result.items);
      setTotal(result.total);
      setWarnings(result.warnings);
      setPage(nextPage);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  function search() {
    setAppliedKeyword(keyword.trim());
    void load({ page: 1 });
  }

  function switchWarning() {
    setOnlyWarning((prev) => !prev);
    void load({ page: 1 });
  }

  function openEditor(row: StockRow) {
    setEditing(row);
    setStockValue(String(row.stock));
    setSafetyValue(String(row.safetyStock));
  }

  async function save() {
    if (!editing) return;
    const stock = Number(stockValue);
    const safetyStock = Number(safetyValue);
    if (!Number.isInteger(stock) || stock < 0) {
      await Taro.showToast({ title: '可售库存需为非负整数', icon: 'none' });
      return;
    }
    if (!Number.isInteger(safetyStock) || safetyStock < 0) {
      await Taro.showToast({ title: '安全库存需为非负整数', icon: 'none' });
      return;
    }
    setSaving(true);
    try {
      await api(`/store-console/stock/${editing.skuId}/adjust`, {
        method: 'POST',
        body: { stock, safetyStock },
      });
      setEditing(null);
      await Taro.showToast({ title: '库存已更新', icon: 'success' });
      await load({ page: 1 });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="page">
      <View className="stock-search">
        <Input
          className="stock-search-input"
          value={keyword}
          placeholder="搜索商品名称或编码"
          confirmType="search"
          onInput={(event) => setKeyword(event.detail.value)}
          onConfirm={search}
        />
        <View className="stock-search-btn" onClick={search}>
          <Text>搜索</Text>
        </View>
      </View>

      <View className="stock-filters">
        <View
          className={`stock-chip${onlyWarning ? '' : ' active'}`}
          onClick={() => (onlyWarning ? switchWarning() : undefined)}
        >
          <Text>全部</Text>
        </View>
        <View
          className={`stock-chip stock-chip--warn${onlyWarning ? ' active' : ''}`}
          onClick={() => (onlyWarning ? undefined : switchWarning())}
        >
          <Text>只看预警 {warnings}</Text>
        </View>
      </View>

      {loading && !rows.length ? (
        <Loading />
      ) : (
        <>
          {!rows.length && <Text className="stock-empty">暂无库存商品</Text>}
          {rows.map((row) => (
            <View className="stock-card" key={row.skuId}>
              <View className="row-between">
                <View className="grow col">
                  <Text className="stock-title">{row.title}</Text>
                  <Text className="muted tiny">
                    {row.specText} · {row.code}
                  </Text>
                </View>
                {row.warning && <Text className="stock-tag">库存预警</Text>}
              </View>

              <View className="stock-metrics">
                <View className="stock-metric">
                  <Text className="stock-metric-value">{row.available}</Text>
                  <Text className="stock-metric-label">可售</Text>
                </View>
                <View className="stock-metric">
                  <Text className="stock-metric-value">{row.stock}</Text>
                  <Text className="stock-metric-label">总库存</Text>
                </View>
                <View className="stock-metric">
                  <Text className="stock-metric-value">{row.reserved}</Text>
                  <Text className="stock-metric-label">已预占</Text>
                </View>
                <View className="stock-metric">
                  <Text className="stock-metric-value">{row.safetyStock}</Text>
                  <Text className="stock-metric-label">安全库存</Text>
                </View>
              </View>

              <View className="stock-actions">
                <View className="stock-btn" onClick={() => openEditor(row)}>
                  <Text>调整库存</Text>
                </View>
              </View>
            </View>
          ))}

          {rows.length < total && (
            <View className="stock-more" onClick={() => (loading ? undefined : void load({ page: page + 1, append: true }))}>
              <Text className="muted small">{loading ? '加载中…' : '加载更多'}</Text>
            </View>
          )}
        </>
      )}

      {editing && (
        <View className="stock-mask" onClick={() => (saving ? undefined : setEditing(null))}>
          <View className="stock-sheet" onClick={(event) => event.stopPropagation()}>
            <Text className="stock-sheet-title">调整库存</Text>
            <Text className="muted tiny stock-sheet-sub">
              {editing.title} · {editing.specText}
            </Text>

            <Text className="stock-field-label">总库存</Text>
            <Input
              className="stock-field"
              type="number"
              value={stockValue}
              placeholder="请输入总库存"
              onInput={(event) => setStockValue(event.detail.value.replace(/\D/g, ''))}
            />

            <Text className="stock-field-label">安全库存（可售低于该值触发预警）</Text>
            <Input
              className="stock-field"
              type="number"
              value={safetyValue}
              placeholder="请输入安全库存"
              onInput={(event) => setSafetyValue(event.detail.value.replace(/\D/g, ''))}
            />

            <View className="stock-sheet-actions">
              <View className="stock-btn" onClick={() => (saving ? undefined : setEditing(null))}>
                <Text>取消</Text>
              </View>
              <View
                className={`stock-btn stock-btn--primary${saving ? ' is-disabled' : ''}`}
                onClick={() => (saving ? undefined : void save())}
              >
                <Text>{saving ? '保存中…' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
