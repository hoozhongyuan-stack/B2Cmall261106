import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { can } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  PageHeader,
  Tabs,
  Tag,
  type Column,
} from '../components/ui';

interface CategoryRow {
  id: string;
  name: string;
  iconKey: string | null;
  sort: number;
  enabled: boolean;
  postCount: number;
  createdAt: string;
}

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  coverKey: string | null;
  categoryId: string | null;
  categoryName: string | null;
  startAt: string | null;
  endAt: string | null;
  pinned: boolean;
  enabled: boolean;
  sort: number;
  postCount: number;
}

type TabValue = 'category' | 'topic';

const TABS: Array<{ value: TabValue; label: string }> = [
  { value: 'category', label: '类目' },
  { value: 'topic', label: '话题' },
];

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

/** ISO → datetime-local 输入值 */
function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const EMPTY_CATEGORY = { id: '', name: '', iconKey: '', sort: '0', enabled: true };
const EMPTY_TOPIC = {
  id: '',
  name: '',
  description: '',
  coverKey: '',
  categoryId: '',
  startAt: '',
  endAt: '',
  pinned: false,
  enabled: true,
  sort: '0',
};

export default function CircleTaxonomy() {
  const canWrite = can('circle.manage');
  const [tab, setTab] = useState<TabValue>('category');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY);
  const [topicForm, setTopicForm] = useState(EMPTY_TOPIC);

  async function load() {
    setLoading(true);
    try {
      const [categoryResult, topicResult] = await Promise.all([
        api<{ items: CategoryRow[] }>('/admin/circle/categories'),
        api<{ items: TopicRow[] }>('/admin/circle/topics'),
      ]);
      setCategories(categoryResult.items);
      setTopics(topicResult.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveCategory() {
    if (!canWrite) return;
    if (!categoryForm.name.trim()) {
      toast('请填写类目名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: categoryForm.name.trim(),
        iconKey: categoryForm.iconKey || null,
        sort: Number(categoryForm.sort) || 0,
        enabled: categoryForm.enabled,
      };
      if (categoryForm.id) {
        await api(`/admin/circle/categories/${categoryForm.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/circle/categories', { method: 'POST', body });
      }
      toast(categoryForm.id ? '类目已保存' : '类目已创建');
      setCategoryForm(EMPTY_CATEGORY);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(row: CategoryRow) {
    try {
      await api(`/admin/circle/categories/${row.id}`, {
        method: 'PATCH',
        body: { name: row.name, enabled: !row.enabled },
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function removeCategory(row: CategoryRow) {
    if (!(await confirmAction(`确定删除类目「${row.name}」吗？`))) return;
    try {
      await api(`/admin/circle/categories/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      if (categoryForm.id === row.id) setCategoryForm(EMPTY_CATEGORY);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function saveTopic() {
    if (!canWrite) return;
    if (!topicForm.name.trim()) {
      toast('请填写话题名称', 'error');
      return;
    }
    if (topicForm.startAt && topicForm.endAt && topicForm.endAt <= topicForm.startAt) {
      toast('结束时间需晚于开始时间', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: topicForm.name.trim(),
        description: topicForm.description.trim(),
        coverKey: topicForm.coverKey || null,
        categoryId: topicForm.categoryId || null,
        startAt: topicForm.startAt ? new Date(topicForm.startAt).toISOString() : null,
        endAt: topicForm.endAt ? new Date(topicForm.endAt).toISOString() : null,
        pinned: topicForm.pinned,
        enabled: topicForm.enabled,
        sort: Number(topicForm.sort) || 0,
      };
      if (topicForm.id) {
        await api(`/admin/circle/topics/${topicForm.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/circle/topics', { method: 'POST', body });
      }
      toast(topicForm.id ? '话题已保存' : '话题已创建');
      setTopicForm(EMPTY_TOPIC);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTopic(row: TopicRow) {
    try {
      await api(`/admin/circle/topics/${row.id}`, {
        method: 'PATCH',
        body: { name: row.name, enabled: !row.enabled },
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function removeTopic(row: TopicRow) {
    if (!(await confirmAction(`确定删除话题「${row.name}」吗？`))) return;
    try {
      await api(`/admin/circle/topics/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      if (topicForm.id === row.id) setTopicForm(EMPTY_TOPIC);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  function editCategory(row: CategoryRow) {
    setCategoryForm({
      id: row.id,
      name: row.name,
      iconKey: row.iconKey ?? '',
      sort: String(row.sort),
      enabled: row.enabled,
    });
  }

  function editTopic(row: TopicRow) {
    setTopicForm({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      coverKey: row.coverKey ?? '',
      categoryId: row.categoryId ?? '',
      startAt: toLocalInput(row.startAt),
      endAt: toLocalInput(row.endAt),
      pinned: row.pinned,
      enabled: row.enabled,
      sort: String(row.sort),
    });
  }

  const categoryColumns: Column<CategoryRow>[] = [
    {
      key: 'name',
      title: '类目',
      minWidth: 180,
      render: (row) => (
        <div className="row" style={{ gap: 10 }}>
          {row.iconKey ? (
            <img
              src={assetPreviewUrl(row.iconKey)}
              alt={row.name}
              style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }}
            />
          ) : (
            <span className="tag tag--muted">无图标</span>
          )}
          <span>{row.name}</span>
        </div>
      ),
    },
    {
      key: 'postCount',
      title: '帖子数',
      align: 'right',
      minWidth: 80,
      nowrap: true,
      render: (row) => <span className="mono">{row.postCount}</span>,
    },
    {
      key: 'sort',
      title: '排序',
      align: 'right',
      minWidth: 70,
      nowrap: true,
      render: (row) => <span className="mono">{row.sort}</span>,
    },
    {
      key: 'enabled',
      title: '状态',
      minWidth: 80,
      render: (row) => (
        <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '190px',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => editCategory(row)}>
              编辑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleCategory(row)}>
              {row.enabled ? '停用' : '启用'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void removeCategory(row)}>
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  const topicColumns: Column<TopicRow>[] = [
    {
      key: 'name',
      title: '话题',
      minWidth: 180,
      render: (row) => (
        <div>
          <div>{row.name}</div>
          {row.description && <div className="small muted cell-clip">{row.description}</div>}
        </div>
      ),
    },
    {
      key: 'category',
      title: '类目',
      minWidth: 100,
      render: (row) => <span className="small">{row.categoryName ?? '不限'}</span>,
    },
    {
      key: 'postCount',
      title: '帖子数',
      align: 'right',
      minWidth: 80,
      nowrap: true,
      render: (row) => <span className="mono">{row.postCount}</span>,
    },
    {
      key: 'time',
      title: '活动时间',
      minWidth: 210,
      nowrap: true,
      className: 'col-hide-lg',
      render: (row) =>
        row.startAt || row.endAt ? (
          <span className="small mono">
            {formatDate(row.startAt)} ~ {formatDate(row.endAt)}
          </span>
        ) : (
          <span className="muted small">长期</span>
        ),
    },
    {
      key: 'flags',
      title: '标记',
      minWidth: 90,
      render: (row) => (
        <div className="row" style={{ gap: 6 }}>
          {row.pinned && <Tag tone="brand">置顶</Tag>}
          <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>
        </div>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '190px',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => editTopic(row)}>
              编辑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleTopic(row)}>
              {row.enabled ? '停用' : '启用'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void removeTopic(row)}>
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="圈子类目与话题"
        desc="类目用于内容分类，话题用于运营聚合；停用后不再出现在小程序发布页"
      />

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'category' ? (
        <>
          {canWrite && (
            <Card title={categoryForm.id ? '编辑类目' : '新建类目'}>
              <div className="grid grid-3">
                <Field label="类目名称" required>
                  <input
                    className="input"
                    value={categoryForm.name}
                    placeholder="山野食谱"
                    onChange={(e) =>
                      setCategoryForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="排序" hint="数值越小越靠前">
                  <input
                    className="input"
                    type="number"
                    value={categoryForm.sort}
                    onChange={(e) =>
                      setCategoryForm((prev) => ({ ...prev, sort: e.target.value }))
                    }
                  />
                </Field>
                <Field label="启用">
                  <label className="row small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={categoryForm.enabled}
                      onChange={(e) =>
                        setCategoryForm((prev) => ({ ...prev, enabled: e.target.checked }))
                      }
                    />
                    小程序展示该类目
                  </label>
                </Field>
              </div>
              <div className="field">
                <span className="field-label">类目图标（选填）</span>
                <div className="row" style={{ gap: 12 }}>
                  {categoryForm.iconKey && (
                    <img
                      src={assetPreviewUrl(categoryForm.iconKey)}
                      alt="类目图标"
                      style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }}
                    />
                  )}
                  <AssetPicker
                    value={categoryForm.iconKey}
                    onChange={(key) => setCategoryForm((prev) => ({ ...prev, iconKey: key }))}
                  />
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {categoryForm.id && (
                  <Button variant="plain" onClick={() => setCategoryForm(EMPTY_CATEGORY)}>
                    取消
                  </Button>
                )}
                <Button loading={saving} onClick={() => void saveCategory()}>
                  {categoryForm.id ? '保存修改' : '新建类目'}
                </Button>
              </div>
            </Card>
          )}

          <Card title="类目列表">
            <DataTable
              columns={categoryColumns}
              rows={categories}
              loading={loading}
              empty="暂无类目，先创建一个吧"
            />
          </Card>
        </>
      ) : (
        <>
          {canWrite && (
            <Card title={topicForm.id ? '编辑话题' : '新建话题'}>
              <div className="grid grid-2">
                <Field label="话题名称" required>
                  <input
                    className="input"
                    value={topicForm.name}
                    placeholder="秋日第一杯茶"
                    onChange={(e) => setTopicForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </Field>
                <Field label="所属类目" hint="留空表示不限类目">
                  <select
                    className="input"
                    value={topicForm.categoryId}
                    onChange={(e) =>
                      setTopicForm((prev) => ({ ...prev, categoryId: e.target.value }))
                    }
                  >
                    <option value="">不限</option>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.enabled ? '' : '（已停用）'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="开始时间" hint="留空表示立即开始">
                  <input
                    className="input"
                    type="datetime-local"
                    value={topicForm.startAt}
                    onChange={(e) =>
                      setTopicForm((prev) => ({ ...prev, startAt: e.target.value }))
                    }
                  />
                </Field>
                <Field label="结束时间" hint="留空表示长期有效">
                  <input
                    className="input"
                    type="datetime-local"
                    value={topicForm.endAt}
                    onChange={(e) => setTopicForm((prev) => ({ ...prev, endAt: e.target.value }))}
                  />
                </Field>
                <Field label="排序" hint="置顶话题优先，其次按排序值">
                  <input
                    className="input"
                    type="number"
                    value={topicForm.sort}
                    onChange={(e) => setTopicForm((prev) => ({ ...prev, sort: e.target.value }))}
                  />
                </Field>
                <Field label="标记">
                  <div className="row" style={{ gap: 16 }}>
                    <label className="row small" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={topicForm.pinned}
                        onChange={(e) =>
                          setTopicForm((prev) => ({ ...prev, pinned: e.target.checked }))
                        }
                      />
                      首页置顶
                    </label>
                    <label className="row small" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={topicForm.enabled}
                        onChange={(e) =>
                          setTopicForm((prev) => ({ ...prev, enabled: e.target.checked }))
                        }
                      />
                      启用
                    </label>
                  </div>
                </Field>
              </div>
              <Field label="话题简介">
                <textarea
                  className="textarea"
                  rows={2}
                  maxLength={200}
                  value={topicForm.description}
                  placeholder="例如：晒出你的秋日茶席与冲泡心得"
                  onChange={(e) =>
                    setTopicForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                />
              </Field>
              <div className="field">
                <span className="field-label">话题封面（选填）</span>
                <div className="row" style={{ gap: 12 }}>
                  {topicForm.coverKey && (
                    <img
                      src={assetPreviewUrl(topicForm.coverKey)}
                      alt="话题封面"
                      style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }}
                    />
                  )}
                  <AssetPicker
                    value={topicForm.coverKey}
                    onChange={(key) => setTopicForm((prev) => ({ ...prev, coverKey: key }))}
                  />
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {topicForm.id && (
                  <Button variant="plain" onClick={() => setTopicForm(EMPTY_TOPIC)}>
                    取消
                  </Button>
                )}
                <Button loading={saving} onClick={() => void saveTopic()}>
                  {topicForm.id ? '保存修改' : '新建话题'}
                </Button>
              </div>
            </Card>
          )}

          <Card title="话题列表">
            <DataTable
              columns={topicColumns}
              rows={topics}
              loading={loading}
              empty="暂无话题，先创建一个吧"
            />
          </Card>
        </>
      )}
    </>
  );
}
