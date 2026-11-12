import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  assetPreviewUrl,
  batchDeleteAssets,
  createAssetFolder,
  deleteAsset,
  deleteAssetFolder,
  formatAssetSize,
  listAssetFolders,
  listAssets,
  moveAsset,
  updateAssetFolder,
  uploadAssets,
  type AssetFolder,
  type AssetItem,
} from '../api/assets';
import { ApiError, formatDate } from '../api/client';
import { can } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import {
  BulkBar,
  Button,
  Card,
  Empty,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Tag,
} from '../components/ui';

const PAGE_SIZE = 30;

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Assets() {
  const canWrite = can('asset.manage');
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [uncategorized, setUncategorized] = useState(0);
  const [folder, setFolder] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [kind, setKind] = useState<'' | 'image' | 'video'>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const [folderModal, setFolderModal] = useState<{
    mode: 'create' | 'rename';
    id?: string;
    name: string;
    originalName?: string;
  } | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFolders() {
    try {
      const result = await listAssetFolders();
      setFolders(result.items);
      setUncategorized(result.uncategorized);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function loadAssets() {
    setLoading(true);
    try {
      const result = await listAssets({
        folderId: folder === 'all' ? undefined : folder,
        keyword: applied || undefined,
        kind: kind || undefined,
        page,
        pageSize,
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
    void loadFolders();
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [folder, applied, page, pageSize, kind]);

  useEffect(() => {
    setSelected([]);
  }, [folder, applied, page]);

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function selectAllPage() {
    const keys = items.filter((item) => item.refCount === 0).map((item) => item.id);
    const allSelected = keys.length > 0 && keys.every((key) => selected.includes(key));
    setSelected(allSelected ? [] : keys);
  }

  async function batchRemoveSelected() {
    const ok = await confirmAction(
      `确定删除选中的 ${selected.length} 张图片吗？已被引用的图片会跳过。`,
      { confirmText: '删除' },
    );
    if (!ok) return;
    setBatching(true);
    try {
      const result = await batchDeleteAssets(selected);
      toast(
        result.failed
          ? `已删除 ${result.success} 张，${result.failed} 张失败：${result.errors?.[0]?.message ?? ''}`
          : `已删除 ${result.success} 张图片`,
        result.failed ? 'error' : 'success',
      );
      setSelected([]);
      await Promise.all([loadAssets(), loadFolders()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBatching(false);
    }
  }

  function switchFolder(next: string) {
    setFolder(next);
    setPage(1);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setApplied(keyword.trim());
    setPage(1);
  }

  async function handleUpload(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (!canWrite) {
      toast('当前角色没有素材管理权限', 'error');
      return;
    }
    setUploading(true);
    try {
      const target = folder === 'all' || folder === 'none' ? null : folder;
      const result = await uploadAssets(files, target);
      toast(`已上传 ${result.items.length} 张图片`);
      setPage(1);
      await Promise.all([loadFolders(), loadAssets()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setUploading(false);
    }
  }

  async function saveFolder() {
    if (!folderModal || !canWrite) return;
    const name = folderModal.name.trim();
    if (!name) {
      toast('请输入文件夹名称', 'error');
      return;
    }
    if (folderModal.mode === 'rename' && name === folderModal.originalName) {
      setFolderModal(null);
      return;
    }

    setFolderSaving(true);
    try {
      if (folderModal.mode === 'create') {
        await createAssetFolder(name);
        toast('文件夹已创建');
      } else if (folderModal.id) {
        await updateAssetFolder(folderModal.id, { name });
        toast('文件夹已重命名');
      }
      setFolderModal(null);
      await loadFolders();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setFolderSaving(false);
    }
  }

  async function removeFolder(item: AssetFolder) {
    if (!canWrite) return;
    if (!(await confirmAction(`确定删除文件夹「${item.name}」吗？仅空文件夹可删除。`))) return;
    try {
      await deleteAssetFolder(item.id);
      toast('已删除');
      if (folder === item.id) setFolder('all');
      await loadFolders();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function moveTo(item: AssetItem, folderId: string) {
    try {
      await moveAsset(item.id, folderId || null);
      toast('已移动');
      await Promise.all([loadAssets(), loadFolders()]);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function remove(item: AssetItem) {
    if (!canWrite) return;
    if (!(await confirmAction(`确定删除图片「${item.originalName ?? item.key}」吗？`))) return;
    try {
      await deleteAsset(item.id);
      toast('已删除');
      await Promise.all([loadAssets(), loadFolders()]);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  function folderButton(value: string, label: string, count: number) {
    const active = folder === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => switchFolder(value)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          cursor: 'pointer',
          background: active ? 'var(--brand)' : 'transparent',
          color: active ? 'var(--on-brand)' : 'inherit',
          fontWeight: active ? 600 : 400,
        }}
      >
        <span>{label}</span>
        <span className="tiny">{count}</span>
      </button>
    );
  }

  return (
    <>
      <PageHeader
        title="素材库"
        desc="本地图片与视频上传、一级文件夹管理；商品与店铺图片只能从素材库选择"
        actions={
          canWrite ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setFolderModal({ mode: 'create', name: '' })}
              >
                新建文件夹
              </Button>
              <Button loading={uploading} onClick={() => fileRef.current?.click()}>
                上传图片或视频
              </Button>
            </>
          ) : undefined
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        multiple
        hidden
        onChange={(e) => {
          void handleUpload(e.target.files);
          e.target.value = '';
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 16 }}>
        <Card title="文件夹">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {folderButton('all', '全部素材', total)}
            {folderButton('none', '未分类', uncategorized)}
            {folders.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <div style={{ flex: 1, minWidth: 0 }}>{folderButton(item.id, item.name, item.count)}</div>
                {canWrite && (
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className="tiny muted"
                      title="重命名"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onClick={() =>
                        setFolderModal({
                          mode: 'rename',
                          id: item.id,
                          name: item.name,
                          originalName: item.name,
                        })
                      }
                    >
                      改
                    </button>
                    <button
                      type="button"
                      className="tiny muted"
                      title="删除"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onClick={() => void removeFolder(item)}
                    >
                      删
                    </button>
                  </div>
                )}
              </div>
            ))}
            {folders.length === 0 && <span className="small muted">还没有文件夹</span>}
          </div>
        </Card>

        <Card>
          <form className="row" style={{ gap: 8, marginBottom: 14 }} onSubmit={search}>
            <input
              className="input"
              style={{ maxWidth: 280 }}
              placeholder="搜索文件名或素材 key"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button type="submit" variant="ghost">
              搜索
            </Button>
            <select
              className="select"
              aria-label="素材类型"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as '' | 'image' | 'video');
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
            </select>
            {applied && (
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeyword('');
                  setApplied('');
                  setPage(1);
                }}
              >
                重置
              </Button>
            )}
            {canWrite && (
              <div className="toolbar-actions">
                <Button type="button" variant="plain" size="sm" onClick={selectAllPage}>
                  {selected.length ? '取消本页选择' : '全选本页'}
                </Button>
              </div>
            )}
          </form>

          {loading ? (
            <div className="table-loading">加载中…</div>
          ) : items.length === 0 ? (
            <Empty text="还没有图片，点击右上角上传" />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                gap: 14,
              }}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--radius-md)',
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {canWrite && (
                    <label className="asset-check">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selected.includes(item.id)}
                        disabled={item.refCount > 0}
                        aria-label={item.refCount > 0 ? '已被引用，不可批量删除' : '选择该图片'}
                        onChange={() => toggleSelect(item.id)}
                      />
                      <span className="tiny muted">
                        {item.refCount > 0 ? '已引用' : selected.includes(item.id) ? '已选' : '选择'}
                      </span>
                    </label>
                  )}
                  {item.mimeType?.startsWith('video/') ? (
                    <video
                      src={assetPreviewUrl(item.key)}
                      muted
                      playsInline
                      preload="metadata"
                      style={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface)',
                      }}
                    />
                  ) : (
                    <img
                      src={assetPreviewUrl(item.key)}
                      alt={item.originalName ?? item.key}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface)',
                      }}
                    />
                  )}
                  <div className="small" style={{ wordBreak: 'break-all' }}>
                    {item.originalName ?? item.key}
                  </div>
                  <div className="row-between">
                    <Tag tone="brand">{item.folderName ?? '未分类'}</Tag>
                    <Tag tone={item.refCount > 0 ? 'warn' : 'muted'}>
                      引用 {item.refCount}
                    </Tag>
                  </div>
                  <div className="tiny muted">
                    {formatAssetSize(item.size)} · {formatDate(item.createdAt)}
                  </div>
                  {canWrite && (
                    <div className="col" style={{ gap: 6 }}>
                      <select
                        className="select"
                        value={item.folderId ?? ''}
                        onChange={(e) => void moveTo(item, e.target.value)}
                      >
                        <option value="">未分类</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={item.refCount > 0}
                        title={item.refCount > 0 ? '已被引用，不能删除' : '删除'}
                        onClick={() => void remove(item)}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <Pagination
            page={page}
            total={total}
            pageSize={pageSize}
            onChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      </div>

      <BulkBar
        count={selected.length}
        onClear={() => setSelected([])}
        actions={[
          {
            label: '批量删除',
            danger: true,
            disabled: batching,
            onClick: () => void batchRemoveSelected(),
          },
        ]}
      />

      <Modal
        open={folderModal !== null}
        title={folderModal?.mode === 'rename' ? '重命名文件夹' : '新建文件夹'}
        onClose={() => setFolderModal(null)}
        footer={
          <>
            <Button type="button" variant="plain" onClick={() => setFolderModal(null)}>
              取消
            </Button>
            <Button
              type="button"
              loading={folderSaving}
              disabled={!folderModal?.name.trim()}
              onClick={() => void saveFolder()}
            >
              保存
            </Button>
          </>
        }
      >
        <Field label="文件夹名称" hint="最多 30 个字符，名称不可重复">
          <input
            className="input"
            autoFocus
            maxLength={30}
            value={folderModal?.name ?? ''}
            placeholder="例如：商品主图"
            onChange={(e) =>
              setFolderModal((prev) => (prev ? { ...prev, name: e.target.value } : prev))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveFolder();
              }
            }}
          />
        </Field>
      </Modal>
    </>
  );
}
