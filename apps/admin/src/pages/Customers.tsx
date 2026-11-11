import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { TagPicker, type TagOption } from '../components/TagPicker';
import {
  BulkBar,
  Button,
  Card,
  DataTable,
  Modal,
  PageHeader,
  Pagination,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface CustomerTag {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
}

interface CustomerRow {
  id: string;
  nickname: string | null;
  phone: string | null;
  levelName: string | null;
  points: number;
  totalSpentCents: number;
  orderCount: number;
  paidCents: number;
  refundedCents: number;
  netCents: number;
  lastOrderAt: string | null;
  createdAt: string;
  tags: CustomerTag[];
}

type TagMode = 'add' | 'remove';

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Customers() {
  const navigate = useNavigate();
  const canTag = hasRole('SUPER', 'OPS', 'CS');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [maxSpent, setMaxSpent] = useState('');
  const [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<TagMode | null>(null);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const PAGE_SIZE = 20;

  async function loadOptions() {
    try {
      const result = await api<{ items: TagOption[] }>('/admin/user-tags/options');
      setTagOptions(result.items);
    } catch {
      /* 标签加载失败不阻塞客户列表 */
    }
  }

  useEffect(() => {
    void loadOptions();
    api<{ id: string; name: string }[]>('/admin/member-levels')
      .then((result) => setLevels(result))
      .catch(() => undefined);
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const result = await api<{ items: CustomerRow[]; total: number }>('/admin/customers', {
        query: {
          keyword: appliedKeyword || undefined,
          tagId: tagFilter || undefined,
          levelId: levelFilter || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          minSpentCents: minSpent ? Math.round(Number(minSpent) * 100) : undefined,
          maxSpentCents: maxSpent ? Math.round(Number(maxSpent) * 100) : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [appliedKeyword, tagFilter, levelFilter, startDate, endDate, minSpent, maxSpent, page]);

  useEffect(() => {
    setSelected([]);
  }, [appliedKeyword, tagFilter, levelFilter, startDate, endDate, minSpent, maxSpent, page]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedKeyword(keyword.trim());
    setPage(1);
  }

  async function submitTags() {
    if (!tagMode) return;
    if (!pickedTags.length) {
      toast('请选择标签', 'error');
      return;
    }
    setSavingTags(true);
    try {
      await api('/admin/customers/batch/tags', {
        method: 'POST',
        body: { userIds: selected, tagIds: pickedTags, mode: tagMode },
      });
      toast(`已${tagMode === 'add' ? '添加' : '移除'}标签，共 ${selected.length} 位客户`);
      setTagMode(null);
      setPickedTags([]);
      setSelected([]);
      await Promise.all([loadOptions(), refresh()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSavingTags(false);
    }
  }

  const roots = tagOptions.filter((item) => !item.parentId);

  const columns: Column<CustomerRow>[] = [
    {
      key: 'nickname',
      title: '客户',
      render: (row) => (
        <div>
          <div>{row.nickname ?? '山野顾客'}</div>
          <div className="small muted">{row.phone ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'levelName',
      title: '等级',
      render: (row) => <span>{row.levelName ?? '普通会员'}</span>,
    },
    {
      key: 'tags',
      title: '标签',
      render: (row) =>
        row.tags.length ? (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {row.tags.slice(0, 3).map((tag) => (
              <Tag key={tag.id} tone={tag.parentId ? 'ok' : 'brand'}>
                {tag.parentName ? `${tag.parentName} / ${tag.name}` : tag.name}
              </Tag>
            ))}
            {row.tags.length > 3 && <span className="tiny muted">+{row.tags.length - 3}</span>}
          </div>
        ) : (
          <span className="muted small">—</span>
        ),
    },
    {
      key: 'points',
      title: '积分',
      align: 'right',
      render: (row) => <span className="mono">{row.points}</span>,
    },
    {
      key: 'totalSpentCents',
      title: '累计消费',
      align: 'right',
      render: (row) => <span className="money">{money(row.totalSpentCents)}</span>,
    },
    {
      key: 'orderCount',
      title: '订单数',
      align: 'right',
      render: (row) => <span className="mono">{row.orderCount}</span>,
    },
    {
      key: 'paidCents',
      title: '实付',
      align: 'right',
      render: (row) => <span className="mono">{money(row.paidCents)}</span>,
    },
    {
      key: 'refundedCents',
      title: '退款',
      align: 'right',
      render: (row) => <span className="mono">{money(row.refundedCents)}</span>,
    },
    {
      key: 'netCents',
      title: '净消费',
      align: 'right',
      render: (row) => <span className="money">{money(row.netCents)}</span>,
    },
    {
      key: 'lastOrderAt',
      title: '最近下单',
      render: (row) => <span className="small mono">{formatDate(row.lastOrderAt)}</span>,
    },
    {
      key: 'createdAt',
      title: '注册时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      width: '160px',
      render: (row) => (
        <div
          className="row"
          style={{ justifyContent: 'flex-end', gap: 6 }}
          onClick={(event) => event.stopPropagation()}
        >
          <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${row.id}`)}>
            查看
          </Button>
          {canTag && (
            <Button
              size="sm"
              onClick={() => {
                setSelected([row.id]);
                setPickedTags([]);
                setTagMode('add');
              }}
            >
              打标签
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="客户列表"
        desc="查看客户等级、标签与消费统计，勾选客户后可批量打标签"
      />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 260 }}
              aria-label="搜索客户"
              placeholder="搜索昵称 / 手机号 / openid"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <select
              className="select"
              aria-label="按标签筛选"
              value={tagFilter}
              onChange={(e) => {
                setTagFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部标签</option>
              {roots.map((root) => (
                <optgroup key={root.id} label={root.name}>
                  <option value={root.id}>{root.name}（含子标签）</option>
                  {tagOptions
                    .filter((item) => item.parentId === root.id)
                    .map((child) => (
                      <option key={child.id} value={child.id}>
                        {root.name} / {child.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <select
              className="select"
              aria-label="按等级筛选"
              value={levelFilter}
              onChange={(e) => {
                setLevelFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部等级</option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              style={{ width: 148 }}
              aria-label="注册开始日期"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
            <span className="muted small">至</span>
            <input
              className="input"
              type="date"
              style={{ width: 148 }}
              aria-label="注册结束日期"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
            <input
              className="input"
              type="number"
              min="0"
              style={{ width: 100 }}
              aria-label="最低累计消费"
              placeholder="最低消费"
              value={minSpent}
              onChange={(e) => {
                setMinSpent(e.target.value);
                setPage(1);
              }}
            />
            <span className="muted small">—</span>
            <input
              className="input"
              type="number"
              min="0"
              style={{ width: 100 }}
              aria-label="最高累计消费"
              placeholder="最高消费"
              value={maxSpent}
              onChange={(e) => {
                setMaxSpent(e.target.value);
                setPage(1);
              }}
            />
            <Button type="submit" variant="ghost">
              搜索
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setKeyword('');
                setAppliedKeyword('');
                setTagFilter('');
                setLevelFilter('');
                setStartDate('');
                setEndDate('');
                setMinSpent('');
                setMaxSpent('');
                setPage(1);
              }}
            >
              重置
            </Button>
          </Toolbar>
        </form>

        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="暂无客户"
          onRowClick={(row) => navigate(`/customers/${row.id}`)}
          selection={canTag ? { selected, onChange: setSelected } : undefined}
        />
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>

      <BulkBar
        count={selected.length}
        hint="批量打标签"
        onClear={() => setSelected([])}
        actions={[
          { label: '添加标签', onClick: () => setTagMode('add') },
          { label: '移除标签', onClick: () => setTagMode('remove'), danger: true },
        ]}
      />

      <Modal
        open={tagMode !== null}
        title={tagMode === 'remove' ? '批量移除标签' : '批量添加标签'}
        onClose={() => {
          setTagMode(null);
          setPickedTags([]);
        }}
        footer={
          <>
            <Button
              variant="plain"
              onClick={() => {
                setTagMode(null);
                setPickedTags([]);
              }}
            >
              取消
            </Button>
            <Button loading={savingTags} onClick={() => void submitTags()}>
              {tagMode === 'remove' ? '确认移除' : '确认添加'}
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          已选 {selected.length} 位客户，标签支持多选。
        </p>
        <TagPicker options={tagOptions} selected={pickedTags} onChange={setPickedTags} />
      </Modal>
    </>
  );
}
