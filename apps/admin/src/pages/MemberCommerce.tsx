import { useEffect, useState } from 'react';

import { api, ApiError, formatDate, money, toCents, toYuan } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Tag,
  type Column,
} from '../components/ui';

interface CardPlan {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  discountRate: number;
  pointsRate: number;
  freeShipping: boolean;
  enabled: boolean;
  sort: number;
}

interface RechargePlan {
  id: string;
  amountCents: number;
  bonusCents: number;
  enabled: boolean;
  sort: number;
}

interface AccountRow {
  id?: string;
  userId: string;
  customer: { nickname: string | null; phone: string | null };
  balanceCents: number;
  totalRechargedCents: number;
  totalConsumedCents: number;
  updatedAt: string;
}

interface LedgerRow {
  id: string;
  userId: string;
  customer: { nickname: string | null; phone: string | null };
  deltaCents: number;
  balanceAfter: number;
  type: string;
  refType: string | null;
  refId: string | null;
  remark: string | null;
  createdAt: string;
}

interface PageResult<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

const LEDGER_LABEL: Record<string, string> = {
  RECHARGE: '充值',
  CARD_PURCHASE: '购买会员卡',
  BALANCE_PAY: '余额支付',
  REFUND: '退款退回',
  ADMIN_ADJUST: '后台调整',
  ROLLBACK: '支付回滚',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function discountText(rate: number): string {
  if (rate >= 1) return '无折扣';
  return `${(rate * 10).toFixed(1).replace(/\.0$/, '')} 折`;
}

export default function MemberCommerce() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [cardPlans, setCardPlans] = useState<CardPlan[]>([]);
  const [rechargePlans, setRechargePlans] = useState<RechargePlan[]>([]);
  const [accounts, setAccounts] = useState<PageResult<AccountRow> | null>(null);
  const [ledger, setLedger] = useState<PageResult<LedgerRow> | null>(null);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(20);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [accountLoading, setAccountLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cardForm, setCardForm] = useState({
    name: '',
    price: '',
    days: '30',
    discount: '0.95',
    pointsRate: '1.5',
    freeShipping: false,
  });
  const [rechargeForm, setRechargeForm] = useState({ amount: '', bonus: '' });
  const [adjustTarget, setAdjustTarget] = useState<AccountRow | null>(null);
  const [adjustForm, setAdjustForm] = useState({ delta: '', reason: '' });

  async function loadPlans() {
    setLoading(true);
    try {
      const [plans, recharges] = await Promise.all([
        api<{ items: CardPlan[] }>('/admin/member-card-plans'),
        api<{ items: RechargePlan[] }>('/admin/recharge-plans'),
      ]);
      setCardPlans(plans.items);
      setRechargePlans(recharges.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    setAccountLoading(true);
    try {
      const result = await api<PageResult<AccountRow>>('/admin/stored-value/accounts', {
        query: { keyword: appliedKeyword, page: accountPage, pageSize: accountPageSize },
      });
      setAccounts(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setAccountLoading(false);
    }
  }

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const result = await api<PageResult<LedgerRow>>('/admin/stored-value/ledger', {
        query: { page: ledgerPage, pageSize: ledgerPageSize },
      });
      setLedger(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLedgerLoading(false);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [appliedKeyword, accountPage, accountPageSize]);

  useEffect(() => {
    void loadLedger();
  }, [ledgerPage, ledgerPageSize]);

  async function createCardPlan() {
    if (!canWrite) return;
    setSaving(true);
    try {
      await api('/admin/member-card-plans', {
        method: 'POST',
        body: {
          name: cardForm.name.trim(),
          priceCents: toCents(cardForm.price),
          durationDays: Number(cardForm.days) || 0,
          discountRate: Number(cardForm.discount) || 1,
          pointsRate: Number(cardForm.pointsRate) || 1,
          freeShipping: cardForm.freeShipping,
        },
      });
      toast('已新增会员卡方案');
      setCardForm({ name: '', price: '', days: '30', discount: '0.95', pointsRate: '1.5', freeShipping: false });
      await loadPlans();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleCardPlan(plan: CardPlan) {
    try {
      await api(`/admin/member-card-plans/${plan.id}`, {
        method: 'PATCH',
        body: { enabled: !plan.enabled },
      });
      await loadPlans();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function createRechargePlan() {
    if (!canWrite) return;
    setSaving(true);
    try {
      await api('/admin/recharge-plans', {
        method: 'POST',
        body: {
          amountCents: toCents(rechargeForm.amount),
          bonusCents: toCents(rechargeForm.bonus || '0'),
        },
      });
      toast('已新增充值套餐');
      setRechargeForm({ amount: '', bonus: '' });
      await loadPlans();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRechargePlan(plan: RechargePlan) {
    try {
      await api(`/admin/recharge-plans/${plan.id}`, {
        method: 'PATCH',
        body: { enabled: !plan.enabled },
      });
      await loadPlans();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function submitAdjust() {
    if (!adjustTarget) return;
    setSaving(true);
    try {
      await api('/admin/stored-value/adjust', {
        method: 'POST',
        body: {
          userId: adjustTarget.userId,
          deltaCents: toCents(adjustForm.delta),
          reason: adjustForm.reason.trim(),
        },
      });
      toast('已调整并记入流水');
      setAdjustTarget(null);
      setAdjustForm({ delta: '', reason: '' });
      await Promise.all([loadAccounts(), loadLedger()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  const cardColumns: Column<CardPlan>[] = [
    { key: 'name', title: '方案', render: (row) => <span>{row.name}</span> },
    { key: 'price', title: '售价', align: 'right', render: (row) => <span className="money">{money(row.priceCents)}</span> },
    { key: 'duration', title: '有效期', render: (row) => <span className="small">{row.durationDays} 天</span> },
    { key: 'discount', title: '折扣', render: (row) => <span className="small">{discountText(row.discountRate)}</span> },
    { key: 'points', title: '积分', render: (row) => <span className="small">×{row.pointsRate}</span> },
    {
      key: 'shipping',
      title: '包邮',
      render: (row) => (row.freeShipping ? <Tag tone="ok">是</Tag> : <span className="muted small">否</span>),
    },
    {
      key: 'enabled',
      title: '状态',
      render: (row) => <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>,
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => void toggleCardPlan(row)}>
            {row.enabled ? '停用' : '启用'}
          </Button>
        ) : null,
    },
  ];

  const rechargeColumns: Column<RechargePlan>[] = [
    { key: 'amount', title: '充值金额', align: 'right', render: (row) => <span className="money">{money(row.amountCents)}</span> },
    {
      key: 'bonus',
      title: '赠送',
      align: 'right',
      render: (row) => <span className="small">{row.bonusCents ? money(row.bonusCents) : '—'}</span>,
    },
    {
      key: 'enabled',
      title: '状态',
      render: (row) => <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>,
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => void toggleRechargePlan(row)}>
            {row.enabled ? '停用' : '启用'}
          </Button>
        ) : null,
    },
  ];

  const accountColumns: Column<AccountRow>[] = [
    {
      key: 'customer',
      title: '客户',
      render: (row) => (
        <div>
          <div>{row.customer.nickname ?? '山野顾客'}</div>
          <div className="small muted">{row.customer.phone ?? row.userId}</div>
        </div>
      ),
    },
    {
      key: 'balance',
      title: '余额',
      align: 'right',
      render: (row) => <span className="money">{money(row.balanceCents)}</span>,
    },
    {
      key: 'recharged',
      title: '累计充值',
      align: 'right',
      render: (row) => <span className="small">{money(row.totalRechargedCents)}</span>,
    },
    {
      key: 'consumed',
      title: '累计消费',
      align: 'right',
      render: (row) => <span className="small">{money(row.totalConsumedCents)}</span>,
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      render: (row) => <span className="small mono">{formatDate(row.updatedAt)}</span>,
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdjustTarget(row);
              setAdjustForm({ delta: '', reason: '' });
            }}
          >
            调整余额
          </Button>
        ) : null,
    },
  ];

  const ledgerColumns: Column<LedgerRow>[] = [
    {
      key: 'createdAt',
      title: '时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'customer',
      title: '客户',
      render: (row) => <span className="small">{row.customer.nickname ?? row.userId}</span>,
    },
    {
      key: 'type',
      title: '类型',
      render: (row) => <span className="small">{LEDGER_LABEL[row.type] ?? row.type}</span>,
    },
    {
      key: 'delta',
      title: '变动',
      align: 'right',
      render: (row) => (
        <span className={`money${row.deltaCents < 0 ? ' muted' : ''}`}>
          {row.deltaCents > 0 ? '+' : ''}
          {money(row.deltaCents)}
        </span>
      ),
    },
    {
      key: 'balance',
      title: '余额',
      align: 'right',
      render: (row) => <span className="small">{money(row.balanceAfter)}</span>,
    },
    {
      key: 'remark',
      title: '说明',
      render: (row) => <span className="small muted">{row.remark ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="会员卡与储值"
        desc="付费会员卡方案、充值套餐、储值账户台账与资金流水；折扣与等级折扣取最优"
      />

      <Card title="会员卡方案">
        {canWrite && (
          <div className="grid grid-3">
            <Field label="方案名称">
              <input
                className="input"
                value={cardForm.name}
                placeholder="山野季卡"
                onChange={(e) => setCardForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </Field>
            <Field label="售价（元）">
              <input
                className="input"
                value={cardForm.price}
                placeholder="49.9"
                onChange={(e) => setCardForm((prev) => ({ ...prev, price: e.target.value }))}
              />
            </Field>
            <Field label="有效期（天）">
              <input
                className="input"
                type="number"
                value={cardForm.days}
                onChange={(e) => setCardForm((prev) => ({ ...prev, days: e.target.value }))}
              />
            </Field>
            <Field label="折扣率" hint="0.95 表示 9.5 折">
              <input
                className="input"
                type="number"
                step="0.01"
                value={cardForm.discount}
                onChange={(e) => setCardForm((prev) => ({ ...prev, discount: e.target.value }))}
              />
            </Field>
            <Field label="积分倍率">
              <input
                className="input"
                type="number"
                step="0.1"
                value={cardForm.pointsRate}
                onChange={(e) => setCardForm((prev) => ({ ...prev, pointsRate: e.target.value }))}
              />
            </Field>
            <Field label="包邮权益">
              <label className="row small" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cardForm.freeShipping}
                  onChange={(e) =>
                    setCardForm((prev) => ({ ...prev, freeShipping: e.target.checked }))
                  }
                />
                购买后全场包邮（偏远地区除外）
              </label>
            </Field>
          </div>
        )}
        {canWrite && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void createCardPlan()}>
              新增方案
            </Button>
          </div>
        )}
        <DataTable columns={cardColumns} rows={cardPlans} loading={loading} empty="暂无会员卡方案" />
      </Card>

      <Card title="充值套餐">
        {canWrite && (
          <div className="grid grid-2">
            <Field label="充值金额（元）">
              <input
                className="input"
                value={rechargeForm.amount}
                placeholder="200"
                onChange={(e) => setRechargeForm((prev) => ({ ...prev, amount: e.target.value }))}
              />
            </Field>
            <Field label="赠送金额（元，选填）">
              <input
                className="input"
                value={rechargeForm.bonus}
                placeholder="20"
                onChange={(e) => setRechargeForm((prev) => ({ ...prev, bonus: e.target.value }))}
              />
            </Field>
          </div>
        )}
        {canWrite && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void createRechargePlan()}>
              新增套餐
            </Button>
          </div>
        )}
        <DataTable
          columns={rechargeColumns}
          rows={rechargePlans}
          loading={loading}
          empty="暂无充值套餐"
        />
      </Card>

      <Card
        title="储值账户"
        extra={
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="搜索昵称 / 手机号"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setAccountPage(1);
                  setAppliedKeyword(keyword.trim());
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAccountPage(1);
                setAppliedKeyword(keyword.trim());
              }}
            >
              搜索
            </Button>
          </div>
        }
      >
        <DataTable
          columns={accountColumns}
          rows={(accounts?.items ?? []).map((item): AccountRow => ({ ...item, id: item.userId }))}
          loading={accountLoading}
          empty="暂无储值账户"
        />
        <Pagination
          page={accountPage}
          total={accounts?.total ?? 0}
          pageSize={accountPageSize}
          onChange={setAccountPage}
          onPageSizeChange={(size) => {
            setAccountPageSize(size);
            setAccountPage(1);
          }}
        />
      </Card>

      <Card title="资金流水">
        <DataTable
          columns={ledgerColumns}
          rows={ledger?.items ?? []}
          loading={ledgerLoading}
          empty="暂无流水"
        />
        <Pagination
          page={ledgerPage}
          total={ledger?.total ?? 0}
          pageSize={ledgerPageSize}
          onChange={setLedgerPage}
          onPageSizeChange={(size) => {
            setLedgerPageSize(size);
            setLedgerPage(1);
          }}
        />
      </Card>

      <Modal
        open={Boolean(adjustTarget)}
        title="调整储值余额"
        onClose={() => setAdjustTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setAdjustTarget(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submitAdjust()}>
              确认调整
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          当前余额 {money(adjustTarget?.balanceCents ?? 0)}；正数增加、负数扣减，均记入流水。
        </p>
        <Field label="变动金额（元，可为负）" hint={`当前余额 ¥${toYuan(adjustTarget?.balanceCents ?? 0)}`}>
          <input
            className="input"
            value={adjustForm.delta}
            placeholder="例如 100 或 -50"
            onChange={(e) => setAdjustForm((prev) => ({ ...prev, delta: e.target.value }))}
          />
        </Field>
        <Field label="调整原因">
          <input
            className="input"
            value={adjustForm.reason}
            placeholder="例如 活动补偿"
            onChange={(e) => setAdjustForm((prev) => ({ ...prev, reason: e.target.value }))}
          />
        </Field>
      </Modal>
    </>
  );
}
