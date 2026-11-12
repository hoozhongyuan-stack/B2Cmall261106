import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { can } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import { Button, Card, Field, Modal, PageHeader, Tag } from '../components/ui';

interface SecretFlag {
  configured: boolean;
}

interface ReleaseView {
  id: string;
  version: string;
  description: string;
  status: 'BUILDING' | 'UPLOADED' | 'FAILED' | 'RELEASED';
  statusText: string;
  size: number;
  hasQrCode: boolean;
  operatorName: string;
  createdAt: string;
  updatedAt: string;
}

interface Readiness {
  appId: string;
  uploadKey: SecretFlag;
  apiBaseUrl: string;
  buildAvailable: boolean;
  latestRelease: ReleaseView | null;
  suggestedVersion: string;
}

const STATUS_TONE: Record<ReleaseView['status'], 'muted' | 'brand' | 'ok' | 'warn' | 'danger'> = {
  BUILDING: 'warn',
  UPLOADED: 'brand',
  RELEASED: 'ok',
  FAILED: 'danger',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function sizeText(size: number): string {
  if (!size) return '—';
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(2)} MB`
    : `${(size / 1024).toFixed(1)} KB`;
}

export default function MiniappRelease() {
  const canWrite = can('miniapp.release');
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [releases, setReleases] = useState<ReleaseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ version: '1.0.0', description: '' });

  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [ready, list] = await Promise.all([
        api<Readiness>('/admin/miniapp/readiness'),
        api<{ items: ReleaseView[] }>('/admin/miniapp/releases'),
      ]);
      setReadiness(ready);
      setReleases(list.items);
      setForm((prev) => ({
        version: prev.version === '1.0.0' ? ready.suggestedVersion : prev.version,
        description: prev.description,
      }));
    } catch (err) {
      if (!silent) toast(errorText(err), 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 有构建中的记录时轮询刷新
  useEffect(() => {
    const building = releases.some((item) => item.status === 'BUILDING');
    if (building && !pollRef.current) {
      pollRef.current = setInterval(() => void load(true), 3000);
    }
    if (!building && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [releases, load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('只有超级管理员可以发布版本', 'error');
      return;
    }
    if (!readiness?.buildAvailable) {
      toast('请先在「小程序与支付」中完成 AppID 与代码上传密钥', 'error');
      return;
    }
    if (!(await confirmAction(`确定构建并上传 ${form.version} 吗？过程中约需 1-2 分钟。`))) return;

    setCreating(true);
    try {
      await api('/admin/miniapp/releases', {
        method: 'POST',
        body: { version: form.version.trim(), description: form.description.trim() },
      });
      toast('已开始构建，请稍候');
      setForm((prev) => ({ ...prev, description: '' }));
      await load(true);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function showLog(id: string) {
    try {
      const detail = await api<ReleaseView & { log: string }>(`/admin/miniapp/releases/${id}`);
      setLogText(detail.log || '暂无日志');
      setLogOpen(true);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function showQrcode(id: string) {
    try {
      const { dataUrl } = await api<{ dataUrl: string }>(`/admin/miniapp/releases/${id}/qrcode`);
      setQrData(dataUrl);
      setQrOpen(true);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function markReleased(id: string) {
    if (!(await confirmAction('确认该版本已在微信后台审核通过并发布？将只更新这里的记录状态。'))) return;
    try {
      await api(`/admin/miniapp/releases/${id}/released`, { method: 'POST' });
      toast('已标记为已发布');
      await load(true);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="小程序发布" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  const notReady = !readiness?.buildAvailable;

  return (
    <>
      <PageHeader
        title="小程序发布"
        desc="服务器构建并上传开发版，生成体验版二维码；审核与发布在微信公众平台完成"
      />

      <Card title="发布环境">
        <div className="grid grid-2">
          <Field label="小程序 AppID">
            <span className="mono">{readiness?.appId || '未配置'}</span>
          </Field>
          <Field label="代码上传密钥">
            {readiness?.uploadKey.configured ? (
              <Tag tone="ok">已配置</Tag>
            ) : (
              <Tag tone="warn">未配置</Tag>
            )}
          </Field>
          <Field label="构建 API 地址">
            <span className="mono">{readiness?.apiBaseUrl || '未配置'}</span>
          </Field>
          <Field label="最近版本">
            {readiness?.latestRelease ? (
              <span className="row">
                <span className="mono">{readiness.latestRelease.version}</span>
                <Tag tone={STATUS_TONE[readiness.latestRelease.status]}>
                  {readiness.latestRelease.statusText}
                </Tag>
              </span>
            ) : (
              <span className="muted small">暂无发布记录</span>
            )}
          </Field>
        </div>
        {notReady && (
          <p className="small" style={{ marginBottom: 0 }}>
            发布前需要在「小程序与支付」里填写 AppID 并上传代码上传密钥；密钥需在微信后台配置服务器 IP
            白名单（43.153.119.73）。
          </p>
        )}
      </Card>

      <Card title="构建并上传">
        {!canWrite && (
          <p className="small muted" style={{ marginTop: 0 }}>
            当前角色仅可查看发布记录。
          </p>
        )}
        <form onSubmit={handleCreate}>
          <div className="grid grid-2">
            <Field label="版本号" hint="x.y.z，同一版本号可重复上传但建议递增">
              <input
                className="input"
                value={form.version}
                disabled={!canWrite}
                onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
              />
            </Field>
            <Field label="更新说明" hint="会显示在微信后台的版本列表">
              <input
                className="input"
                value={form.description}
                disabled={!canWrite}
                placeholder="本次更新内容"
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </Field>
          </div>
          <div className="row-between">
            <span className="small muted">
              构建约 1-2 分钟；完成后可在版本记录里查看体验版二维码与日志
            </span>
            <Button type="submit" loading={creating} disabled={!canWrite || notReady}>
              构建并上传
            </Button>
          </div>
        </form>
      </Card>

      <Card title="版本记录">
        {!releases.length ? (
          <div className="empty">还没有发布记录</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>状态</th>
                  <th>大小</th>
                  <th>更新说明</th>
                  <th>操作人</th>
                  <th>时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.version}</td>
                    <td>
                      <Tag tone={STATUS_TONE[item.status]}>{item.statusText}</Tag>
                    </td>
                    <td>{sizeText(item.size)}</td>
                    <td>{item.description}</td>
                    <td>{item.operatorName || '—'}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        {item.hasQrCode && (
                          <Button variant="ghost" size="sm" onClick={() => void showQrcode(item.id)}>
                            二维码
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => void showLog(item.id)}>
                          日志
                        </Button>
                        {canWrite && item.status === 'UPLOADED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void markReleased(item.id)}
                          >
                            标记已发布
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          上传成功后，请到{' '}
          <a href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">
            微信公众平台
          </a>{' '}
          的「版本管理」提交审核并发布；微信未开放自建小程序的审核/发布 API，因此这两步需在平台完成。
        </p>
      </Card>

      <Modal open={logOpen} title="构建日志" onClose={() => setLogOpen(false)}>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto' }}>
          {logText}
        </pre>
      </Modal>

      <Modal open={qrOpen} title="体验版二维码" onClose={() => setQrOpen(false)}>
        {qrData ? (
          <div style={{ textAlign: 'center' }}>
            <img src={qrData} alt="体验版二维码" style={{ width: 240, height: 240 }} />
            <p className="small muted">用微信扫码体验；正式发布仍需在微信后台提交审核</p>
          </div>
        ) : (
          <div className="empty">二维码加载中…</div>
        )}
      </Modal>
    </>
  );
}
