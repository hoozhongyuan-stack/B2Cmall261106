import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { can } from '../auth';
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
  RowActions,
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
type GrantType = 'coupon' | 'card' | 'level';

interface CouponOption {
  id: string;
  name: string;
  faceValueCents: number;
  thresholdCents: number;
}

interface CardPlanOption {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  discountRate: number;
  enabled: boolean;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Customers() {
  const navigate = useNavigate();
  const canTag = can('customer.edit');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [maxSpent, setMaxSpent] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
  const [appliedMinSpent, setAppliedMinSpent] = useState('');
  const [appliedMaxSpent, setAppliedMaxSpent] = useState('');
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
  const [grantType, setGrantType] = useState<GrantType | null>(null);
  const [grantTargets, setGrantTargets] = useState<string[]>([]);
  const [couponOptions, setCouponOptions] = useState<CouponOption[]>([]);
  const [cardPlans, setCardPlans] = useState<CardPlanOption[]>([]);
  const [couponId, setCouponId] = useState('');
  const [planId, setPlanId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [savingGrant, setSavingGrant] = useState(false);
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
    api<{ items: CouponOption[] }>('/admin/coupons', {
      query: { enabled: 'true', pageSize: 100 },
    })
      .then((result) => setCouponOptions(result.items))
      .catch(() => undefined);
    api<{ items: CardPlanOption[] }>('/admin/member-card-plans')
      .then((result) => setCardPlans(result.items.filter((item) => item.enabled)))
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
          startDate: appliedStartDate || undefined,
          endDate: appliedEndDate || undefined,
          minSpentCents: appliedMinSpent ? Math.round(Number(appliedMinSpent) * 100) : undefined,
          maxSpentCents: appliedMaxSpent ? Math.round(Number(appliedMaxSpent) * 100) : undefined,
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
  }, [
    appliedKeyword,
    tagFilter,
    levelFilter,
    appliedStartDate,
    appliedEndDate,
    appliedMinSpent,
    appliedMaxSpent,
    page,
  ]);

  useEffect(() => {
    setSelected([]);
  }, [
    appliedKeyword,
    tagFilter,
    levelFilter,
    appliedStartDate,
    appliedEndDate,
    appliedMinSpent,
    appliedMaxSpent,
    page,
  ]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedKeyword(keyword.trim());
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setAppliedMinSpent(minSpent);
    setAppliedMaxSpent(maxSpent);
    setPage(1);
  }

  function resetFilters() {
    setKeyword('');
    setAppliedKeyword('');
    setTagFilter('');
    setLevelFilter('');
    setStartDate('');
    setEndDate('');
    setMinSpent('');
    setMaxSpent('');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setAppliedMinSpent('');
    setAppliedMaxSpent('');
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

  function openGrant(type: GrantType, userIds: string[]) {
    if (!userIds.length) return;
    setGrantTargets(userIds);
    setGrantType(type);
    if (type === 'coupon') setCouponId(couponOptions[0]?.id ?? '');
    if (type === 'card') setPlanId(cardPlans[0]?.id ?? '');
    if (type === 'level') setLevelId('');
  }

  async function submitGrant() {
    if (!grantType) return;
    setSavingGrant(true);
    try {
      if (grantType === 'coupon') {
        if (!couponId) throw new Error('请选择优惠券');
        const result = await api<{ granted: number; skipped: { reason: string }[] }>(
          '/admin/customers/batch/coupons',
          { method: 'POST', body: { userIds: grantTargets, couponId } },
        );
        toast(
          `已发放 ${result.granted} 人${
            result.skipped.length ? `，跳过 ${result.skipped.length} 人（已达限领或库存不足）` : ''
          }`,
          result.skipped.length ? 'error' : 'success',
        );
      } else if (grantType === 'card') {
        if (!planId) throw new Error('请选择会员卡方案');
        const result = await api<{ granted: number; skipped: { reason: string }[] }>(
          '/admin/customers/batch/member-cards',
          { method: 'POST', body: { userIds: grantTargets, planId } },
        );
        toast(
          `已为 ${result.granted} 人发放会员卡${
            result.skipped.length ? `，跳过 ${result.skipped.length} 人` : ''
          }`,
          result.skipped.length ? 'error' : 'success',
        );
      } else {
        const result = await api<{ updated: number }>('/admin/customers/batch/levels', {
          method: 'POST',
          body: { userIds: grantTargets, levelId: levelId || null },
        });
        toast(`已调整 ${result.updated} 位客户的会员等级`);
      }
      setGrantType(null);
      setGrantTargets([]);
      setSelected([]);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setSavingGrant(false);
    }
  }

  const roots = tagOptions.filter((item) => !item.parentId);

  const columns: Column<CustomerRow>[] = [
    {
      key: 'nickname',
      title: '客户',
      minWidth: 130,
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
      minWidth: 72,
      nowrap: true,
      render: (row) => <span>{row.levelName ?? '普通会员'}</span>,
    },
    {
      key: 'tags',
      title: '标签',
      minWidth: 140,
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
      minWidth: 72,
      nowrap: true,
      render: (row) => <span className="mono">{row.points}</span>,
    },
    {
      key: 'totalSpentCents',
      title: '累计消费',
      align: 'right',
      minWidth: 100,
      nowrap: true,
      render: (row) => <span className="money">{money(row.totalSpentCents)}</span>,
    },
    {
      key: 'orderCount',
      title: '订单数',
      align: 'right',
      minWidth: 72,
      nowrap: true,
      render: (row) => <span className="mono">{row.orderCount}</span>,
    },
    {
      key: 'paidCents',
      title: '实付',
      align: 'right',
      minWidth: 92,
      nowrap: true,
      className: 'col-hide-md',
      render: (row) => <span className="mono">{money(row.paidCents)}</span>,
    },
    {
      key: 'refundedCents',
      title: '退款',
      align: 'right',
      minWidth: 90,
      nowrap: true,
      className: 'col-hide-lg',
      render: (row) => <span className="mono">{money(row.refundedCents)}</span>,
    },
    {
      key: 'netCents',
      title: '净消费',
      align: 'right',
      minWidth: 92,
      nowrap: true,
      render: (row) => <span className="money">{money(row.netCents)}</span>,
    },
    {
      key: 'lastOrderAt',
      title: '最近下单',
      minWidth: 120,
      nowrap: true,
      className: 'col-hide-md',
      render: (row) => <span className="small mono">{formatDate(row.lastOrderAt)}</span>,
    },
    {
      key: 'createdAt',
      title: '注册时间',
      minWidth: 120,
      nowrap: true,
      className: 'col-hide-lg',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      width: '130px',
      render: (row) => (
        <div onClick={(event) => event.stopPropagation()}>
          <RowActions
            primary={{ label: '查看', onClick: () => navigate(`/customers/${row.id}`) }}
            actions={
              canTag
                ? [
                    { label: '发放优惠券', onClick: () => openGrant('coupon', [row.id]) },
                    { label: '发放会员卡', onClick: () => openGrant('card', [row.id]) },
                    { label: '调整会员等级', onClick: () => openGrant('level', [row.id]) },
                    {
                      label: '打标签',
                      onClick: () => {
                        setSelected([row.id]);
                        setPickedTags([]);
                        setTagMode('add');
                      },
                    },
                  ]
                : []
            }
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="客户列表"
        desc="查看客户等级、标签与消费统计；单行或勾选后可发放优惠券、发放会员卡、调整会员等级与打标签"
      />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 220 }}
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
            <span className="filter-range">
              <input
                className="input"
                type="date"
                style={{ width: 132 }}
                aria-label="注册开始日期"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span className="muted small">至</span>
              <input
                className="input"
                type="date"
                style={{ width: 132 }}
                aria-label="注册结束日期"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </span>
            <span className="filter-range">
              <input
                className="input"
                type="number"
                min="0"
                style={{ width: 92 }}
                aria-label="最低累计消费"
                placeholder="最低消费"
                value={minSpent}
                onChange={(e) => setMinSpent(e.target.value)}
              />
              <span className="muted small">—</span>
              <input
                className="input"
                type="number"
                min="0"
                style={{ width: 92 }}
                aria-label="最高累计消费"
                placeholder="最高消费"
                value={maxSpent}
                onChange={(e) => setMaxSpent(e.target.value)}
              />
            </span>
            <div className="toolbar-actions">
              <Button type="button" variant="plain" onClick={resetFilters}>
                重置
              </Button>
              <Button type="submit" variant="ghost">
                搜索
              </Button>
            </div>
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
        hint="批量操作"
        onClear={() => setSelected([])}
        actions={[
          { label: '发放优惠券', onClick: () => openGrant('coupon', selected) },
          { label: '发放会员卡', onClick: () => openGrant('card', selected) },
          { label: '调整会员等级', onClick: () => openGrant('level', selected) },
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

      <Modal
        open={grantType !== null}
        title={
          grantType === 'coupon'
            ? '发放优惠券'
            : grantType === 'card'
              ? '发放会员卡'
              : '调整会员等级'
        }
        onClose={() => {
          setGrantType(null);
          setGrantTargets([]);
        }}
        footer={
          <>
            <Button
              variant="plain"
              onClick={() => {
                setGrantType(null);
                setGrantTargets([]);
              }}
            >
              取消
            </Button>
            <Button loading={savingGrant} onClick={() => void submitGrant()}>
              确认发放
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          已选 {grantTargets.length} 位客户。
        </p>

        {grantType === 'coupon' && (
          <label className="field">
            <span className="field-label">选择优惠券</span>
            {couponOptions.length ? (
              <select
                className="select"
                value={couponId}
                onChange={(event) => setCouponId(event.target.value)}
              >
                {couponOptions.map((coupon) => (
                  <option key={coupon.id} value={coupon.id}>
                    {coupon.name}（满 {money(coupon.thresholdCents)} 减{' '}
                    {money(coupon.faceValueCents)}）
                  </option>
                ))}
              </select>
            ) : (
              <span className="small muted">暂无启用中的优惠券，请先在「营销 → 优惠券」创建</span>
            )}
          </label>
        )}

        {grantType === 'card' && (
          <label className="field">
            <span className="field-label">选择会员卡方案</span>
            {cardPlans.length ? (
              <select
                className="select"
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
              >
                {cardPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}（{plan.durationDays} 天 · 折扣 {plan.discountRate * 10} 折）
                  </option>
                ))}
              </select>
            ) : (
              <span className="small muted">
                暂无启用中的会员卡方案，请先在「会员 → 会员卡」创建
              </span>
            )}
          </label>
        )}

        {grantType === 'level' && (
          <label className="field">
            <span className="field-label">调整到</span>
            <select
              className="select"
              value={levelId}
              onChange={(event) => setLevelId(event.target.value)}
            >
              <option value="">清除人工等级（按累计消费自动匹配）</option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="small muted">
          {grantType === 'card'
            ? '发放后立即生效，原生效卡会自动标记为已替换；不扣减客户储值余额。'
            : grantType === 'coupon'
              ? '已达每人限领或券已领完的客户会自动跳过。'
              : '人工等级会覆盖按累计消费自动匹配的结果，后续按消费升级时可能被重新计算。'}
        </p>
      </Modal>
    </>
  );
}
