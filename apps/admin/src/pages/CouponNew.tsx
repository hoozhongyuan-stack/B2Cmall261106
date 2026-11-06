import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, toCents } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CouponNew() {
  const navigate = useNavigate();
  const canWrite = hasRole('SUPER', 'OPS');
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 86_400_000);

  const [name, setName] = useState('');
  const [hasThreshold, setHasThreshold] = useState(true);
  const [thresholdYuan, setThresholdYuan] = useState('0');
  const [faceYuan, setFaceYuan] = useState('');
  const [total, setTotal] = useState('100');
  const [perLimit, setPerLimit] = useState('1');
  const [startAt, setStartAt] = useState(toLocalInput(now));
  const [endAt, setEndAt] = useState(toLocalInput(weekLater));
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('当前角色没有优惠券创建权限', 'error');
      return;
    }
    if (!name.trim()) {
      toast('请填写优惠券名称', 'error');
      return;
    }
    const faceValueCents = toCents(faceYuan);
    if (faceValueCents <= 0) {
      toast('券面额必须大于 0', 'error');
      return;
    }
    const thresholdCents = hasThreshold ? toCents(thresholdYuan) : 0;
    if (thresholdCents > 0 && thresholdCents < faceValueCents) {
      toast('使用门槛不得低于券面额', 'error');
      return;
    }
    const totalCount = Number(total);
    if (!Number.isInteger(totalCount) || totalCount <= 0) {
      toast('发放总量必须为正整数', 'error');
      return;
    }
    const limit = Number(perLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      toast('每人限领必须为正整数', 'error');
      return;
    }
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      toast('有效期区间不合法', 'error');
      return;
    }

    setSaving(true);
    try {
      await api('/admin/coupons', {
        method: 'POST',
        body: {
          name: name.trim(),
          thresholdCents,
          faceValueCents,
          total: totalCount,
          perLimit: limit,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      });
      toast('已保存');
      navigate('/coupons');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="新建优惠券"
        desc="满减券需设置使用门槛，无门槛券门槛为 0"
        actions={
          <Button variant="ghost" onClick={() => navigate('/coupons')}>
            返回列表
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <Card title="券信息">
          <div className="grid grid-2">
            <Field label="名称">
              <input
                className="input"
                value={name}
                placeholder="例如：新人无门槛 10 元券"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="券类型">
              <select
                className="select"
                value={hasThreshold ? 'threshold' : 'none'}
                onChange={(e) => setHasThreshold(e.target.value === 'threshold')}
              >
                <option value="threshold">满减券（有门槛）</option>
                <option value="none">无门槛券</option>
              </select>
            </Field>
            {hasThreshold && (
              <Field label="使用门槛（元）">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={thresholdYuan}
                  onChange={(e) => setThresholdYuan(e.target.value)}
                />
              </Field>
            )}
            <Field label="券面额（元）">
              <input
                className="input"
                type="number"
                step="0.01"
                value={faceYuan}
                placeholder="例如：10"
                onChange={(e) => setFaceYuan(e.target.value)}
              />
            </Field>
            <Field label="发放总量">
              <input
                className="input"
                type="number"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </Field>
            <Field label="每人限领">
              <input
                className="input"
                type="number"
                value={perLimit}
                onChange={(e) => setPerLimit(e.target.value)}
              />
            </Field>
            <Field label="开始时间">
              <input
                className="input"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </Field>
            <Field label="结束时间">
              <input
                className="input"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <div className="row-between">
          <span className="small muted">优惠券创建后默认启用，可在列表页停用</span>
          <Button type="submit" loading={saving} disabled={!canWrite}>
            保存并启用
          </Button>
        </div>
      </form>
    </>
  );
}
