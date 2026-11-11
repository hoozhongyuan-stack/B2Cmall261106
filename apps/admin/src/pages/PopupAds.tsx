import { useEffect, useState } from 'react';

import { POPUP_AD_LIMITS } from '@shanye/shared/src/popupAd';
import type { MicroLink } from '@shanye/shared/src/microPage';

import { assetPreviewUrl } from '../api/assets';
import { ApiError, formatDate } from '../api/client';
import {
  createPopupAd,
  deletePopupAd,
  listPopupAds,
  togglePopupAd,
  updatePopupAd,
  type PopupAd,
  type PopupAdInput,
} from '../api/popupAds';
import { AssetPicker } from '../components/AssetPicker';
import { LinkField, NumberInput, TextInput } from '../components/microPage/fields';
import { confirmAction } from '../components/confirm';
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
  Toolbar,
  type Column,
} from '../components/ui';

const PAGE_SIZE = 20;

interface ModalState {
  open: boolean;
  editing: PopupAd | null;
  name: string;
  imageKey: string;
  alt: string;
  link: MicroLink;
  priority: number;
  enabled: boolean;
  startAt: string;
  endAt: string;
}

const CLOSED: ModalState = {
  open: false,
  editing: null,
  name: '',
  imageKey: '',
  alt: '',
  link: { type: 'none', value: null },
  priority: 0,
  enabled: true,
  startAt: '',
  endAt: '',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function PopupAds() {
  const [items, setItems] = useState<PopupAd[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<ModalState>(CLOSED);

  async function load() {
    setLoading(true);
    try {
      const result = await listPopupAds({
        keyword: applied || undefined,
        page,
        pageSize: PAGE_SIZE,
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
    void load();
  }, [applied, page]);

  const enabledCount = items.filter((item) => item.enabled).length;

  function openCreate() {
    setModal({ ...CLOSED, open: true });
  }

  function openEdit(item: PopupAd) {
    setModal({
      open: true,
      editing: item,
      name: item.name,
      imageKey: item.imageKey,
      alt: item.alt ?? '',
      link: item.link ?? { type: 'none', value: null },
      priority: item.priority,
      enabled: item.enabled,
      startAt: toLocalInput(item.startAt),
      endAt: toLocalInput(item.endAt),
    });
  }

  async function save() {
    if (!modal.name.trim()) {
      toast('请填写名称', 'error');
      return;
    }
    if (!modal.imageKey) {
      toast('请选择弹窗图片', 'error');
      return;
    }
    const input: PopupAdInput = {
      name: modal.name.trim(),
      imageKey: modal.imageKey,
      alt: modal.alt.trim() || null,
      link: modal.link,
      priority: modal.priority,
      enabled: modal.enabled,
      startAt: modal.startAt ? new Date(modal.startAt).toISOString() : null,
      endAt: modal.endAt ? new Date(modal.endAt).toISOString() : null,
    };
    setSaving(true);
    try {
      if (modal.editing) await updatePopupAd(modal.editing.id, input);
      else await createPopupAd(input);
      toast('已保存');
      setModal(CLOSED);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: PopupAd, enabled: boolean) {
    try {
      await togglePopupAd(item.id, enabled);
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, enabled } : row)));
      toast(enabled ? '已启用' : '已停用');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function remove(item: PopupAd) {
    if (!(await confirmAction(`确定删除「${item.name}」吗？`))) return;
    try {
      await deletePopupAd(item.id);
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<PopupAd>[] = [
    {
      key: 'image',
      title: '图片',
      width: '90px',
      render: (row) => (
        <img
          src={assetPreviewUrl(row.imageKey)}
          alt={row.name}
          style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 6 }}
        />
      ),
    },
    {
      key: 'name',
      title: '名称 / 优先级',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong>{row.name}</strong>
          <span className="tiny muted">优先级 {row.priority}</span>
        </div>
      ),
    },
    {
      key: 'time',
      title: '投放时间',
      width: '220px',
      render: (row) => (
        <span className="small muted">
          {row.startAt || row.endAt
            ? `${formatDate(row.startAt)} ~ ${formatDate(row.endAt)}`
            : '长期有效'}
        </span>
      ),
    },
    {
      key: 'enabled',
      title: '状态',
      width: '90px',
      render: (row) => (
        <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(event) => void toggle(row, event.target.checked)}
          />
          {row.enabled ? '启用' : '停用'}
        </label>
      ),
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      width: '160px',
      render: (row) => <span className="small muted">{formatDate(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      width: '140px',
      render: (row) => (
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="弹窗广告"
        desc={`首页居中弹窗；每条每天最多展示一次，多条按优先级依次弹出（最多同时启用 ${POPUP_AD_LIMITS.maxActive} 条）`}
        actions={<Button onClick={openCreate}>新建弹窗</Button>}
      />

      <Toolbar>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="搜索名称"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setApplied(keyword.trim());
              setPage(1);
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setApplied(keyword.trim());
            setPage(1);
          }}
        >
          搜索
        </Button>
        <Tag tone={enabledCount >= POPUP_AD_LIMITS.maxActive ? 'warn' : 'muted'}>
          当前页启用 {enabledCount} / {POPUP_AD_LIMITS.maxActive}
        </Tag>
      </Toolbar>

      <Card>
        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="还没有弹窗广告，点击右上角新建"
        />
      </Card>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />

      <Modal
        open={modal.open}
        title={modal.editing ? '编辑弹窗广告' : '新建弹窗广告'}
        wide
        onClose={() => setModal(CLOSED)}
        footer={
          <>
            <Button variant="plain" onClick={() => setModal(CLOSED)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        <div className="popup-form">
          <div className="popup-form-fields">
            <Field label="名称" required hint="仅后台展示">
              <TextInput
                value={modal.name}
                maxLength={20}
                placeholder="例如 双十一主会场"
                onChange={(next) => setModal((prev) => ({ ...prev, name: next }))}
              />
            </Field>
            <Field label="弹窗图片（3:4）" required hint="建议 750×1000，≤5MB">
              <AssetPicker
                value={modal.imageKey}
                onChange={(key) => setModal((prev) => ({ ...prev, imageKey: key }))}
              />
            </Field>
            <Field label="替代文案" hint="图片加载失败时展示">
              <TextInput
                value={modal.alt}
                maxLength={40}
                onChange={(next) => setModal((prev) => ({ ...prev, alt: next }))}
              />
            </Field>
            <LinkField
              value={modal.link}
              onChange={(link) => setModal((prev) => ({ ...prev, link }))}
              label="点击跳转"
            />
            <div className="grid grid-2">
              <Field label="优先级" hint="数字越大越先弹">
                <NumberInput
                  value={modal.priority}
                  onChange={(next) => setModal((prev) => ({ ...prev, priority: next }))}
                />
              </Field>
              <Field label="启用">
                <label className="row small" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={modal.enabled}
                    onChange={(event) =>
                      setModal((prev) => ({ ...prev, enabled: event.target.checked }))
                    }
                  />
                  保存后立即生效
                </label>
              </Field>
              <Field label="开始时间" hint="留空表示不限">
                <input
                  className="input"
                  type="datetime-local"
                  value={modal.startAt}
                  onChange={(event) =>
                    setModal((prev) => ({ ...prev, startAt: event.target.value }))
                  }
                />
              </Field>
              <Field label="结束时间" hint="留空表示不限">
                <input
                  className="input"
                  type="datetime-local"
                  value={modal.endAt}
                  onChange={(event) => setModal((prev) => ({ ...prev, endAt: event.target.value }))}
                />
              </Field>
            </div>
          </div>

          <div className="popup-preview">
            <div className="popup-preview-phone">
              <div className="popup-preview-mask">
                <div className="popup-preview-card">
                  {modal.imageKey ? (
                    <img src={assetPreviewUrl(modal.imageKey)} alt="弹窗预览" />
                  ) : (
                    <span className="popup-preview-empty">3:4 图片</span>
                  )}
                  <span className="popup-preview-close">×</span>
                </div>
              </div>
            </div>
            <span className="small muted">小程序首页效果预览</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
