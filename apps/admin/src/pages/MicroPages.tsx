import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { MICRO_PAGE_LIMITS } from '@shanye/shared/src/microPage';

import { ApiError, formatDate } from '../api/client';
import {
  createMicroPage,
  deleteMicroPage,
  duplicateMicroPage,
  listMicroPages,
  migrateLegacyHome,
  removeMicroPageHome,
  setMicroPageHome,
  type MicroPageSummary,
} from '../api/microPages';
import {
  Button,
  Confirm,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Pagination,
  RowActions,
  Tabs,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';
import { toast } from '../components/toast';

const PAGE_SIZE = 20;

type StatusTab = 'ALL' | 'PUBLISHED' | 'DRAFT';

export default function MicroPages() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<MicroPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCode, setNewCode] = useState('');
  const [copyFromId, setCopyFromId] = useState('');
  const [promote, setPromote] = useState<MicroPageSummary | null>(null);
  const [deleting, setDeleting] = useState<MicroPageSummary | null>(null);
  const [homeTarget, setHomeTarget] = useState<MicroPageSummary | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await listMicroPages({
        keyword: applied || undefined,
        status: tab === 'ALL' ? undefined : tab,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result.items);
      setTotal(result.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tab, applied, page]);

  const hasHome = rows.some((row) => row.isHome);

  async function handleCreate() {
    if (!newTitle.trim()) {
      toast('请填写页面名称', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await createMicroPage({
        title: newTitle.trim(),
        code: newCode.trim() || undefined,
        copyFromId: copyFromId || undefined,
      });
      toast('页面已创建');
      setCreateOpen(false);
      navigate(`/settings/home/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '创建失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleMigrate() {
    setBusy(true);
    try {
      const result = await migrateLegacyHome();
      toast(result.created ? '已生成首页微页面，可在列表中设为首页' : '首页微页面已存在');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '迁移失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetHome(row: MicroPageSummary) {
    setBusy(true);
    try {
      await setMicroPageHome(row.id);
      toast('已设为小程序首页');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '设置失败', 'error');
    } finally {
      setBusy(false);
      setHomeTarget(null);
    }
  }

  async function handleRemoveHome() {
    setBusy(true);
    try {
      await removeMicroPageHome();
      toast('已回退旧版首页');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(row: MicroPageSummary) {
    try {
      const copy = await duplicateMicroPage(row.id);
      toast('已复制为新草稿');
      navigate(`/settings/home/${copy.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '复制失败', 'error');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteMicroPage(deleting.id);
      toast('已删除');
      setDeleting(null);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '删除失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<MicroPageSummary>[] = [
    {
      key: 'title',
      title: '页面名称',
      render: (row) => (
        <div className="micro-page-title">
          <strong>{row.title}</strong>
          <span className="tiny muted">{row.code}</span>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: '180px',
      render: (row) => (
        <div className="row" style={{ gap: 6 }}>
          <Tag tone={row.status === 'PUBLISHED' ? 'ok' : 'muted'}>
            {row.status === 'PUBLISHED' ? `已上线 v${row.version}` : '草稿'}
          </Tag>
          {row.isHome && <Tag tone="brand">首页</Tag>}
        </div>
      ),
    },
    {
      key: 'components',
      title: '组件',
      width: '110px',
      render: (row) => (
        <span className="small muted">
          {row.publishedComponentCount} / {row.componentCount}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      width: '170px',
      render: (row) => <span className="small muted">{formatDate(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      width: '190px',
      render: (row) => (
        <RowActions
          primary={{ label: '编辑', onClick: () => navigate(`/settings/home/${row.id}`) }}
          actions={[
            { label: '复制', onClick: () => void handleDuplicate(row) },
            { label: '推广', onClick: () => setPromote(row) },
            {
              label: row.isHome ? '取消首页' : '设为首页',
              onClick: () => (row.isHome ? void handleRemoveHome() : setHomeTarget(row)),
              disabled: !row.isHome && row.status !== 'PUBLISHED',
            },
            { label: '删除', danger: true, onClick: () => setDeleting(row) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="页面装修"
        desc="搭建小程序首页与活动微页面，配置底部导航；保存草稿后上线生效"
        actions={
          <>
            <Button variant="ghost" loading={busy} onClick={() => void handleMigrate()}>
              迁移旧首页
            </Button>
            <Button onClick={() => setCreateOpen(true)}>新建微页面</Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(next) => {
          setTab(next);
          setPage(1);
        }}
        items={[
          { value: 'ALL', label: '全部' },
          { value: 'PUBLISHED', label: '已上线' },
          { value: 'DRAFT', label: '草稿' },
        ]}
      />

      <Toolbar>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="搜索页面名称或标识"
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
        {hasHome && (
          <span className="small muted">当前已启用微页面首页</span>
        )}
        <Link className="small muted" to="/settings/home/legacy" style={{ marginLeft: 'auto' }}>
          旧版首页设置
        </Link>
      </Toolbar>

      <DataTable columns={columns} rows={rows} loading={loading} empty="还没有微页面，点击右上角新建" />
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />

      <Modal
        open={createOpen}
        title="新建微页面"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button loading={busy} onClick={() => void handleCreate()}>
              创建并编辑
            </Button>
          </>
        }
      >
        <Field label="页面名称" required>
          <input
            className="input"
            maxLength={20}
            placeholder={`例如 双十一专场（最多 ${MICRO_PAGE_LIMITS.maxPages} 个页面）`}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
          />
        </Field>
        <Field label="页面标识（选填）" hint="小写字母、数字与短横线，用于推广路径；留空自动生成">
          <input
            className="input"
            value={newCode}
            placeholder="例如 new-arrivals"
            onChange={(event) => setNewCode(event.target.value)}
          />
        </Field>
        <Field label="复制现有页面（选填）">
          <select
            className="input"
            value={copyFromId}
            onChange={(event) => setCopyFromId(event.target.value)}
          >
            <option value="">空白页面</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </select>
        </Field>
      </Modal>

      <Modal
        open={Boolean(promote)}
        title="推广页面"
        onClose={() => setPromote(null)}
        footer={
          <Button variant="ghost" onClick={() => setPromote(null)}>
            关闭
          </Button>
        }
      >
        {promote && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="小程序路径" hint="可配置到公众号菜单、小程序码或分享卡片">
              <input
                className="input"
                readOnly
                value={`/pages/micro/index?code=${promote.code}`}
              />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`/pages/micro/index?code=${promote.code}`)
                    .then(() => toast('路径已复制'))
                    .catch(() => toast('复制失败，请手动选择', 'error'));
                }}
              >
                复制路径
              </Button>
              <span className="small muted">
                {promote.status === 'PUBLISHED' ? '页面已上线，可直接推广' : '页面未上线，推广后无法访问'}
              </span>
            </div>
          </div>
        )}
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        title="删除微页面"
        text={`确认删除「${deleting?.title ?? ''}」？被底部导航或其他页面链接引用时无法删除。`}
        confirmText="删除"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />

      <Confirm
        open={Boolean(homeTarget)}
        title="设为小程序首页"
        text={`确认把「${homeTarget?.title ?? ''}」设为首页？设置后小程序首页将立即使用该页面，可在列表随时回退旧版首页。`}
        confirmText="设为首页"
        onConfirm={() => homeTarget && void handleSetHome(homeTarget)}
        onCancel={() => setHomeTarget(null)}
      />
    </>
  );
}
