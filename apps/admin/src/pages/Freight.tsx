import { useEffect, useState } from 'react';

import { api, ApiError, money, toCents, toYuan } from '../api/client';
import { hasRole } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface RegionRow {
  id: string;
  regionName: string;
  freightCents: number;
}

interface ShopDetail {
  freeThresholdCents: number;
  flatFreightCents: number;
  regions: RegionRow[];
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Freight() {
  const canWrite = hasRole('SUPER');
  const [thresholdYuan, setThresholdYuan] = useState('0');
  const [flatFreightYuan, setFlatFreightYuan] = useState('0');
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionName, setRegionName] = useState('');
  const [regionFreightYuan, setRegionFreightYuan] = useState('');
  const [regionSaving, setRegionSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<ShopDetail>('/admin/shop');
      setThresholdYuan(toYuan(result.freeThresholdCents));
      setFlatFreightYuan(toYuan(result.flatFreightCents));
      setRegions(result.regions);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveFreight() {
    if (!canWrite) {
      toast('只有超级管理员可以修改运费规则', 'error');
      return;
    }
    const thresholdCents = toCents(thresholdYuan);
    const flatFreightCents = toCents(flatFreightYuan);
    if (thresholdCents < 0 || flatFreightCents < 0) {
      toast('运费与门槛不能为负数', 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/admin/shop', {
        method: 'PATCH',
        body: { freeThresholdCents: thresholdCents, flatFreightCents },
      });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addRegion() {
    if (!regionName.trim()) {
      toast('请填写地区名称', 'error');
      return;
    }
    const freightCents = toCents(regionFreightYuan);
    if (freightCents < 0) {
      toast('运费不能为负数', 'error');
      return;
    }
    setRegionSaving(true);
    try {
      await api('/admin/shop/regions', {
        method: 'POST',
        body: { regionName: regionName.trim(), freightCents },
      });
      toast('已保存');
      setRegionOpen(false);
      setRegionName('');
      setRegionFreightYuan('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setRegionSaving(false);
    }
  }

  async function removeRegion(row: RegionRow) {
    if (!(await confirmAction(`确定删除「${row.regionName}」的运费规则吗？`))) return;
    try {
      await api(`/admin/shop/regions/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<RegionRow>[] = [
    { key: 'regionName', title: '地区', render: (row) => <span>{row.regionName}</span> },
    {
      key: 'freightCents',
      title: '运费',
      align: 'right',
      render: (row) => <span className="money">{money(row.freightCents)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button size="sm" variant="danger" onClick={() => void removeRegion(row)}>
            删除
          </Button>
        ) : (
          <Tag>只读</Tag>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="运费模板" desc="默认按满额包邮与固定运费计算，地区例外优先" />

      <Card title="基础运费">
        {!canWrite && (
          <p className="small muted" style={{ marginTop: 0 }}>
            当前角色仅可查看运费规则，修改需要超级管理员权限。
          </p>
        )}
        <div className="grid grid-2">
          <Field label="满额包邮门槛（元）" hint="按券后商品金额判断">
            <input
              className="input"
              type="number"
              step="0.01"
              value={thresholdYuan}
              disabled={!canWrite}
              onChange={(e) => setThresholdYuan(e.target.value)}
            />
          </Field>
          <Field label="固定运费（元）" hint="未达包邮门槛时收取">
            <input
              className="input"
              type="number"
              step="0.01"
              value={flatFreightYuan}
              disabled={!canWrite}
              onChange={(e) => setFlatFreightYuan(e.target.value)}
            />
          </Field>
        </div>
        {canWrite && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void saveFreight()}>
              保存运费
            </Button>
          </div>
        )}
      </Card>

      <Card
        title="地区例外"
        extra={
          canWrite ? (
            <Button size="sm" variant="ghost" onClick={() => setRegionOpen(true)}>
              新增地区
            </Button>
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={regions}
          loading={loading}
          empty="暂无地区例外，全部按基础运费计算"
        />
      </Card>

      <Modal
        open={regionOpen}
        title="新增地区运费"
        onClose={() => setRegionOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setRegionOpen(false)}>
              取消
            </Button>
            <Button loading={regionSaving} onClick={() => void addRegion()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="地区名称" hint="例如：新疆 / 西藏 / 内蒙古">
          <input
            className="input"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
          />
        </Field>
        <Field label="运费（元）">
          <input
            className="input"
            type="number"
            step="0.01"
            value={regionFreightYuan}
            onChange={(e) => setRegionFreightYuan(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
