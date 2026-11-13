import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { can } from '../auth';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

interface CircleSettings {
  enabled: boolean;
  auditMode: 'HYBRID' | 'REVIEW';
  dailyPostLimit: number;
  dailyCommentLimit: number;
  postPoints: number;
  postPointsDailyLimit: number;
  updatedAt: string;
}

const DEFAULT_SETTINGS: CircleSettings = {
  enabled: true,
  auditMode: 'HYBRID',
  dailyPostLimit: 5,
  dailyCommentLimit: 30,
  postPoints: 10,
  postPointsDailyLimit: 1,
  updatedAt: '',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CircleSettings() {
  const canWrite = can('circle.manage');
  const [settings, setSettings] = useState<CircleSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<CircleSettings>('/admin/circle/settings');
      setSettings(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setField<K extends keyof CircleSettings>(key: K, value: CircleSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!canWrite) return;
    setSaving(true);
    try {
      const result = await api<CircleSettings>('/admin/circle/settings', {
        method: 'PATCH',
        body: {
          enabled: settings.enabled,
          auditMode: settings.auditMode,
          dailyPostLimit: Number(settings.dailyPostLimit) || 0,
          dailyCommentLimit: Number(settings.dailyCommentLimit) || 0,
          postPoints: Number(settings.postPoints) || 0,
          postPointsDailyLimit: Number(settings.postPointsDailyLimit) || 0,
        },
      });
      setSettings(result);
      toast('圈子设置已保存');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="圈子设置" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="圈子设置"
        desc="控制圈子开关、审核模式、发帖频率与发帖积分奖励"
        actions={
          <Button loading={saving} disabled={!canWrite} onClick={() => void save()}>
            保存设置
          </Button>
        }
      />

      {!canWrite && (
        <p className="small muted" style={{ marginTop: 0 }}>
          当前角色仅可查看圈子设置，需要「类目 / 话题 / 圈子设置」权限才能修改。
        </p>
      )}

      <Card title="基础设置">
        <div className="grid grid-2">
          <Field label="圈子开关" hint="关闭后小程序入口隐藏，已有内容与数据保留">
            <label className="row small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={settings.enabled}
                disabled={!canWrite}
                onChange={(e) => setField('enabled', e.target.checked)}
              />
              开启圈子
            </label>
          </Field>
          <Field
            label="审核模式"
            hint={
              settings.auditMode === 'HYBRID'
                ? '机审通过即发布，命中风险自动隐藏并进入待审'
                : '所有内容先进入待审，人工通过后才会展示'
            }
          >
            <select
              className="input"
              value={settings.auditMode}
              disabled={!canWrite}
              onChange={(e) => setField('auditMode', e.target.value as 'HYBRID' | 'REVIEW')}
            >
              <option value="HYBRID">机审后发布（推荐）</option>
              <option value="REVIEW">先审后发</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title="发帖与互动">
        <div className="grid grid-2">
          <Field label="每人每日发帖上限" hint="0 表示不限制">
            <input
              className="input"
              type="number"
              min="0"
              value={settings.dailyPostLimit}
              disabled={!canWrite}
              onChange={(e) => setField('dailyPostLimit', Number(e.target.value))}
            />
          </Field>
          <Field label="每人每日评论上限" hint="0 表示不限制">
            <input
              className="input"
              type="number"
              min="0"
              value={settings.dailyCommentLimit}
              disabled={!canWrite}
              onChange={(e) => setField('dailyCommentLimit', Number(e.target.value))}
            />
          </Field>
          <Field label="发帖奖励积分" hint="审核通过后发放，0 表示不奖励">
            <input
              className="input"
              type="number"
              min="0"
              value={settings.postPoints}
              disabled={!canWrite}
              onChange={(e) => setField('postPoints', Number(e.target.value))}
            />
          </Field>
          <Field label="积分奖励每日上限" hint="每人每天最多获得几次发帖积分">
            <input
              className="input"
              type="number"
              min="0"
              value={settings.postPointsDailyLimit}
              disabled={!canWrite}
              onChange={(e) => setField('postPointsDailyLimit', Number(e.target.value))}
            />
          </Field>
        </div>
        {settings.updatedAt && (
          <span className="small muted">最近更新：{formatDate(settings.updatedAt)}</span>
        )}
      </Card>
    </>
  );
}
