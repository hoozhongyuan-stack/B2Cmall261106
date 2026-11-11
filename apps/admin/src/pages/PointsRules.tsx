import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader, Tag } from '../components/ui';

interface PointsConfig {
  yuanPerPoint: number;
  signInPoints: number;
  signInStreakDays: number;
  signInStreakBonusType: 'POINTS' | 'COUPON';
  signInStreakBonusPoints: number;
  signInStreakCouponId: string | null;
  sharePoints: number;
  shareDailyLimit: number;
}

interface CouponOption {
  id: string;
  name: string;
  enabled: boolean;
}

interface FormState {
  yuanPerPoint: string;
  signInPoints: string;
  signInStreakDays: string;
  bonusType: 'POINTS' | 'COUPON';
  bonusPoints: string;
  couponId: string;
  sharePoints: string;
  shareDailyLimit: string;
}

const EMPTY_FORM: FormState = {
  yuanPerPoint: '1',
  signInPoints: '1',
  signInStreakDays: '7',
  bonusType: 'POINTS',
  bonusPoints: '0',
  couponId: '',
  sharePoints: '0',
  shareDailyLimit: '0',
};

function toForm(config: PointsConfig): FormState {
  return {
    yuanPerPoint: String(config.yuanPerPoint),
    signInPoints: String(config.signInPoints),
    signInStreakDays: String(config.signInStreakDays),
    bonusType: config.signInStreakBonusType,
    bonusPoints: String(config.signInStreakBonusPoints),
    couponId: config.signInStreakCouponId ?? '',
    sharePoints: String(config.sharePoints),
    shareDailyLimit: String(config.shareDailyLimit),
  };
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function PointsRules() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [config, couponList] = await Promise.all([
        api<PointsConfig>('/admin/points-config'),
        api<{ items: CouponOption[] }>('/admin/coupons', {
          query: { enabled: 'true', pageSize: 100 },
        }).catch(() => ({ items: [] })),
      ]);
      setForm(toForm(config));
      setCoupons(couponList.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('当前角色仅可查看积分规则', 'error');
      return;
    }
    const payload = {
      yuanPerPoint: Number(form.yuanPerPoint),
      signInPoints: Number(form.signInPoints),
      signInStreakDays: Number(form.signInStreakDays),
      signInStreakBonusType: form.bonusType,
      signInStreakBonusPoints: Number(form.bonusPoints),
      signInStreakCouponId: form.bonusType === 'COUPON' ? form.couponId || null : null,
      sharePoints: Number(form.sharePoints),
      shareDailyLimit: Number(form.shareDailyLimit),
    };
    if (!Number.isInteger(payload.yuanPerPoint) || payload.yuanPerPoint < 1) {
      toast('消费积分比例需为大于 0 的整数', 'error');
      return;
    }
    if (payload.signInStreakDays > 0 && form.bonusType === 'COUPON' && !payload.signInStreakCouponId) {
      toast('请选择连续签到赠送的优惠券', 'error');
      return;
    }

    setSaving(true);
    try {
      const saved = await api<PointsConfig>('/admin/points-config', {
        method: 'PUT',
        body: payload,
      });
      setForm(toForm(saved));
      toast('积分规则已保存');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="积分规则" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  const yuan = Number(form.yuanPerPoint) || 1;
  const sampleCents = 9990;
  const samplePoints = Math.floor(sampleCents / (100 * yuan));
  const signIn = Number(form.signInPoints) || 0;
  const streakDays = Number(form.signInStreakDays) || 0;
  const bonusPoints = Number(form.bonusPoints) || 0;
  const selectedCoupon = coupons.find((item) => item.id === form.couponId);
  const sharePoints = Number(form.sharePoints) || 0;
  const shareLimit = Number(form.shareDailyLimit) || 0;

  return (
    <>
      <PageHeader
        title="积分规则"
        desc="配置消费、签到与分享的积分发放规则；积分仅记录，不参与订单抵扣"
        actions={
          <Button type="submit" form="points-rules-form" loading={saving} disabled={!canWrite}>
            保存规则
          </Button>
        }
      />

      <form id="points-rules-form" onSubmit={save} className="points-rules">
        <div className="points-rules-main">
          {!canWrite && (
            <div className="points-rules-readonly">当前角色仅可查看积分规则，无法修改。</div>
          )}

          <Card title="消费获得积分">
            <div className="points-rule-head">
              <span className="points-rule-badge">消费</span>
              <p className="small muted">
                订单支付成功后按实付金额发放；退款成功时按同一口径扣回，余额最低为 0。
              </p>
            </div>
            <div className="grid grid-2">
              <Field label="消费多少元获得 1 积分" required hint="整数，例如 1 表示 1 元 1 分">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.yuanPerPoint}
                  disabled={!canWrite}
                  onChange={(event) => setField('yuanPerPoint', event.target.value)}
                />
              </Field>
              <Field label="发放示例">
                <div className="points-rule-example">
                  实付 {money(sampleCents)} → <strong>{samplePoints}</strong> 积分
                </div>
              </Field>
            </div>
          </Card>

          <Card title="每日签到">
            <div className="points-rule-head">
              <span className="points-rule-badge">签到</span>
              <p className="small muted">
                每天可签到一次；连续签到达到设定天数时，额外赠送积分或优惠券。
              </p>
            </div>
            <div className="grid grid-3">
              <Field label="每日签到积分" hint="0 表示关闭签到">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1000}
                  value={form.signInPoints}
                  disabled={!canWrite}
                  onChange={(event) => setField('signInPoints', event.target.value)}
                />
              </Field>
              <Field label="连续签到天数" hint="0 表示不做连续奖励">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={365}
                  value={form.signInStreakDays}
                  disabled={!canWrite}
                  onChange={(event) => setField('signInStreakDays', event.target.value)}
                />
              </Field>
              <Field label="连续奖励方式">
                <select
                  className="select"
                  value={form.bonusType}
                  disabled={!canWrite || streakDays === 0}
                  onChange={(event) =>
                    setField('bonusType', event.target.value as 'POINTS' | 'COUPON')
                  }
                >
                  <option value="POINTS">额外赠送积分</option>
                  <option value="COUPON">赠送优惠券</option>
                </select>
              </Field>
              {form.bonusType === 'POINTS' ? (
                <Field label="额外赠送积分" hint="达到连续天数时一次性发放">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={10000}
                    value={form.bonusPoints}
                    disabled={!canWrite || streakDays === 0}
                    onChange={(event) => setField('bonusPoints', event.target.value)}
                  />
                </Field>
              ) : (
                <Field label="赠送优惠券" hint="仅在连续天数 > 0 时生效">
                  <select
                    className="select"
                    value={form.couponId}
                    disabled={!canWrite || streakDays === 0}
                    onChange={(event) => setField('couponId', event.target.value)}
                  >
                    <option value="">选择优惠券</option>
                    {coupons.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="签到示例" wide>
                <div className="points-rule-example">
                  每日签到 +{signIn} 分
                  {streakDays > 0
                    ? form.bonusType === 'POINTS'
                      ? `；连续 ${streakDays} 天再送 ${bonusPoints} 分`
                      : `；连续 ${streakDays} 天送「${selectedCoupon?.name ?? '未选择优惠券'}」`
                    : '；未开启连续奖励'}
                </div>
              </Field>
            </div>
          </Card>

          <Card title="分享奖励">
            <div className="points-rule-head">
              <span className="points-rule-badge">分享</span>
              <p className="small muted">
                用户把小程序分享给好友时发放积分，按天限制有效次数，超出后不再发放。
              </p>
            </div>
            <div className="grid grid-3">
              <Field label="每次分享赠送积分" hint="0 表示关闭分享奖励">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1000}
                  value={form.sharePoints}
                  disabled={!canWrite}
                  onChange={(event) => setField('sharePoints', event.target.value)}
                />
              </Field>
              <Field label="每天最多计入次数" hint="0 表示关闭分享奖励">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={form.shareDailyLimit}
                  disabled={!canWrite}
                  onChange={(event) => setField('shareDailyLimit', event.target.value)}
                />
              </Field>
              <Field label="分享示例">
                <div className="points-rule-example">
                  每天最多 {shareLimit} 次，每次 +{sharePoints} 分
                </div>
              </Field>
            </div>
          </Card>

          <Card title="积分说明">
            <p className="small muted" style={{ marginTop: 0 }}>
              当前版本积分不参与订单金额抵扣，仅作为会员成长与运营激励的记录。后台可在客户详情中手动调整积分。
            </p>
            <div className="row" style={{ gap: 8 }}>
              <Tag tone="brand">ORDER_PAID</Tag>
              <span className="small muted">订单支付发放</span>
              <Tag tone="warn">REFUND</Tag>
              <span className="small muted">退款扣回</span>
              <Tag tone="ok">SIGN_IN</Tag>
              <span className="small muted">每日签到</span>
              <Tag>SHARE</Tag>
              <span className="small muted">分享奖励</span>
            </div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn btn-ghost btn-sm" to="/customers">
                前往客户列表调整积分
              </Link>
            </div>
          </Card>
        </div>

        <aside className="points-rules-aside">
          <Card title="规则摘要">
            <ul className="points-summary">
              <li>
                <span>消费积分</span>
                <strong>{yuan > 0 ? `每 ${yuan} 元 1 分` : '未设置'}</strong>
              </li>
              <li>
                <span>每日签到</span>
                <strong>{signIn > 0 ? `+${signIn} 分` : '已关闭'}</strong>
              </li>
              <li>
                <span>连续签到</span>
                <strong>
                  {streakDays > 0
                    ? `${streakDays} 天${
                        form.bonusType === 'POINTS'
                          ? ` +${bonusPoints} 分`
                          : ` 送「${selectedCoupon?.name ?? '未选择'}」`
                      }`
                    : '未开启'}
                </strong>
              </li>
              <li>
                <span>分享奖励</span>
                <strong>
                  {sharePoints > 0 && shareLimit > 0
                    ? `每天 ${shareLimit} 次 · 每次 +${sharePoints} 分`
                    : '已关闭'}
                </strong>
              </li>
            </ul>
            <p className="small muted">
              保存后立即生效，小程序「积分明细」会按新规则发放；历史流水不会重算。
            </p>
            <Button type="submit" loading={saving} disabled={!canWrite} className="points-save">
              保存规则
            </Button>
          </Card>
        </aside>
      </form>
    </>
  );
}
