import { useEffect, useRef, useState } from 'react';

import {
  assetPreviewUrl,
  formatAssetSize,
  listAssetFolders,
  listAssets,
  uploadAssets,
  type AssetFolder,
  type AssetItem,
} from '../api/assets';
import { toast } from './toast';
import { Button, Empty, Modal, Pagination, Tabs } from './ui';

const PAGE_SIZE = 24;

interface BaseProps {
  disabled?: boolean;
  hint?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (key: string) => void;
}

interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (keys: string[]) => void;
}

type AssetPickerProps = SingleProps | MultiProps;

function valuesOf(props: AssetPickerProps): string[] {
  if (props.multiple) return props.value;
  return props.value ? [props.value] : [];
}

function emitValue(props: AssetPickerProps, keys: string[]): void {
  if (props.multiple) props.onChange(keys);
  else props.onChange(keys[0] ?? '');
}

/** 素材选择器：只允许从素材库选图，支持单选与多选（有序） */
export function AssetPicker(props: AssetPickerProps) {
  const { disabled, hint } = props;
  const multiple = props.multiple === true;
  const currentKeys = valuesOf(props);

  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [uncategorized, setUncategorized] = useState(0);
  const [folder, setFolder] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFolders() {
    try {
      const result = await listAssetFolders();
      setFolders(result.items);
      setUncategorized(result.uncategorized);
    } catch {
      /* 文件夹加载失败不阻塞选图 */
    }
  }

  async function loadAssets() {
    setLoading(true);
    try {
      const result = await listAssets({
        folderId: folder === 'all' ? undefined : folder,
        keyword: appliedKeyword || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : '素材加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadFolders();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadAssets();
  }, [open, folder, appliedKeyword, page]);

  function openPicker() {
    setSelected(valuesOf(props));
    setKeyword('');
    setAppliedKeyword('');
    setFolder('all');
    setPage(1);
    setOpen(true);
  }

  function switchFolder(next: string) {
    setFolder(next);
    setPage(1);
  }

  function search() {
    setAppliedKeyword(keyword.trim());
    setPage(1);
  }

  function toggle(key: string) {
    if (!multiple) {
      setSelected([key]);
      return;
    }
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  function move(index: number, delta: number) {
    const next = [...currentKeys];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    emitValue(props, next);
  }

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await uploadAssets(
        files,
        folder === 'all' || folder === 'none' ? null : folder,
      );
      toast(`已上传 ${result.items.length} 张`);
      setPage(1);
      await Promise.all([loadAssets(), loadFolders()]);
      const keys = result.items.map((item) => item.key);
      setSelected((prev) => (multiple ? [...prev, ...keys] : keys.slice(0, 1)));
    } catch (err) {
      toast(err instanceof Error ? err.message : '上传失败', 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {multiple ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {currentKeys.length > 0 && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {currentKeys.map((key, index) => (
                <div key={`${key}-${index}`} style={{ width: 92 }}>
                  <img
                    src={assetPreviewUrl(key)}
                    alt={`已选图片 ${index + 1}`}
                    style={{
                      width: 92,
                      height: 92,
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-2)',
                    }}
                  />
                  <div className="row-between" style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="tiny muted"
                      title="前移"
                      disabled={index === 0}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <span className="tiny muted">{index + 1}</span>
                    <button
                      type="button"
                      className="tiny muted"
                      title="移除"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onClick={() =>
                        emitValue(
                          props,
                          currentKeys.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="tiny muted"
                      title="后移"
                      disabled={index === currentKeys.length - 1}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={openPicker}
            >
              {currentKeys.length ? '继续选择' : '从素材库选择'}
            </Button>
            {currentKeys.length > 0 && (
              <Button
                type="button"
                variant="plain"
                size="sm"
                disabled={disabled}
                onClick={() => emitValue(props, [])}
              >
                清空
              </Button>
            )}
          </div>
          <span className="small muted">
            {currentKeys.length
              ? `已选 ${currentKeys.length} 张，第一张为主图，可用 ↑ ↓ 调整顺序`
              : hint || '图片仅支持从素材库选择，不支持直接填写链接'}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flex: '0 0 auto',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            {currentKeys[0] ? (
              <img
                src={assetPreviewUrl(currentKeys[0])}
                alt="已选图片"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              '未选择'
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={openPicker}
              >
                从素材库选择
              </Button>
              {currentKeys[0] && (
                <Button
                  type="button"
                  variant="plain"
                  size="sm"
                  disabled={disabled}
                  onClick={() => emitValue(props, [])}
                >
                  清除
                </Button>
              )}
            </div>
            <span className="small muted" style={{ wordBreak: 'break-all' }}>
              {currentKeys[0] || hint || '图片仅支持从素材库选择，不支持直接填写链接'}
            </span>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <Modal
        open={open}
        title={multiple ? '选择图片（可多选）' : '选择图片'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button type="button" variant="plain" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={selected.length === 0}
              onClick={() => {
                if (!selected.length) return;
                emitValue(props, selected);
                setOpen(false);
              }}
            >
              {multiple && selected.length > 0
                ? `确定选择（${selected.length}）`
                : '确定选择'}
            </Button>
          </>
        }
      >
        <div className="row-between" style={{ marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <Tabs
            value={folder}
            onChange={switchFolder}
            items={[
              { value: 'all', label: '全部' },
              { value: 'none', label: '未分类', count: uncategorized },
              ...folders.map((item) => ({
                value: item.id,
                label: item.name,
                count: item.count,
              })),
            ]}
          />
          <Button
            type="button"
            size="sm"
            loading={uploading}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            上传图片
          </Button>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索文件名或素材 key"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={search}>
            搜索
          </Button>
          {appliedKeyword && (
            <Button
              type="button"
              variant="plain"
              size="sm"
              onClick={() => {
                setKeyword('');
                setAppliedKeyword('');
                setPage(1);
              }}
            >
              重置
            </Button>
          )}
        </div>

        {loading ? (
          <div className="table-loading">加载中…</div>
        ) : items.length === 0 ? (
          <Empty text="还没有图片，先上传一张吧" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 10,
              maxHeight: 430,
              overflowY: 'auto',
            }}
          >
            {items.map((item) => {
              const checked = selected.includes(item.key);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.key)}
                  onDoubleClick={() => {
                    if (!multiple) {
                      emitValue(props, [item.key]);
                      setOpen(false);
                    }
                  }}
                  style={{
                    padding: 8,
                    borderRadius: 'var(--radius-sm)',
                    border: checked ? '2px solid var(--brand)' : '2px solid transparent',
                    background: 'var(--surface-2)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    position: 'relative',
                  }}
                >
                  {checked && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        background: 'var(--brand)',
                        color: 'var(--on-brand)',
                        fontSize: 12,
                        lineHeight: '20px',
                        textAlign: 'center',
                      }}
                    >
                      ✓
                    </span>
                  )}
                  <img
                    src={assetPreviewUrl(item.key)}
                    alt={item.originalName ?? item.key}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: 90,
                      objectFit: 'cover',
                      borderRadius: 4,
                      background: 'var(--surface)',
                    }}
                  />
                  <div className="small" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                    {item.originalName ?? item.key}
                  </div>
                  <div className="tiny muted">
                    {formatAssetSize(item.size)}
                    {item.refCount > 0 ? ` · 引用 ${item.refCount}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </Modal>
    </>
  );
}
