import { Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';

import './settings.css';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface DayHours {
  enabled: boolean;
  open: string;
  close: string;
}

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: '周一' },
  { key: 'tue', label: '周二' },
  { key: 'wed', label: '周三' },
  { key: 'thu', label: '周四' },
  { key: 'fri', label: '周五' },
  { key: 'sat', label: '周六' },
  { key: 'sun', label: '周日' },
];

interface Settings {
  id: string;
  name: string;
  code: string;
  notice: string | null;
  businessHours: Record<string, unknown>;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  temporarilyClosedUntil: string | null;
  temporaryClosureNote: string | null;
}

const CLOSURE_HOURS = [1, 2, 4, 8];

function emptyHours(): Record<DayKey, DayHours> {
  return Object.fromEntries(
    DAYS.map((day) => [day.key, { enabled: true, open: '09:00', close: '18:00' }]),
  ) as Record<DayKey, DayHours>;
}

function toForm(hours: Record<string, unknown>): Record<DayKey, DayHours> {
  const form = emptyHours();
  if (!hours || !Object.keys(hours).length) return form;
  for (const day of DAYS) {
    const ranges = hours[day.key];
    if (!Array.isArray(ranges) || !ranges.length) {
      form[day.key] = { ...form[day.key], enabled: false };
      continue;
    }
    const first = ranges[0] as unknown;
    if (Array.isArray(first) && first.length === 2) {
      form[day.key] = {
        enabled: true,
        open: String(first[0]),
        close: String(first[1]),
      };
    }
  }
  return form;
}

export default function Page() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState('');
  const [hours, setHours] = useState<Record<DayKey, DayHours>>(emptyHours());
  const [pickupEnabled, setPickupEnabled] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [closedUntil, setClosedUntil] = useState<string | null>(null);
  const [closureNote, setClosureNote] = useState('');
  const [closureHours, setClosureHours] = useState(2);
  const [closureBusy, setClosureBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api<Settings>('/store-console/settings');
      setSettings(data);
      setNotice(data.notice ?? '');
      setHours(toForm(data.businessHours ?? {}));
      setPickupEnabled(data.pickupEnabled);
      setDeliveryEnabled(data.deliveryEnabled);
      setClosedUntil(data.temporarilyClosedUntil);
      setClosureNote(data.temporaryClosureNote ?? '');
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  function patchDay(day: DayKey, patch: Partial<DayHours>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  const closureActive = Boolean(closedUntil && new Date(closedUntil).getTime() > Date.now());

  async function closeNow() {
    const until = new Date(Date.now() + closureHours * 60 * 60 * 1000).toISOString();
    setClosureBusy(true);
    try {
      const data = await api<Settings>('/store-console/closure', {
        method: 'POST',
        body: { until, note: closureNote.trim() },
      });
      setClosedUntil(data.temporarilyClosedUntil);
      setClosureNote(data.temporaryClosureNote ?? '');
      await Taro.showToast({ title: '已临时打烊', icon: 'success' });
    } catch (err) {
      showError(err);
    } finally {
      setClosureBusy(false);
    }
  }

  async function reopen() {
    setClosureBusy(true);
    try {
      const data = await api<Settings>('/store-console/closure', {
        method: 'POST',
        body: { until: null },
      });
      setClosedUntil(data.temporarilyClosedUntil);
      setClosureNote('');
      await Taro.showToast({ title: '已恢复营业', icon: 'success' });
    } catch (err) {
      showError(err);
    } finally {
      setClosureBusy(false);
    }
  }

  async function save() {
    const businessHours: Record<string, string[][]> = {};
    for (const day of DAYS) {
      const value = hours[day.key];
      if (!value.enabled) {
        businessHours[day.key] = [];
        continue;
      }
      if (value.close <= value.open) {
        await Taro.showToast({ title: `${day.label}结束时间需晚于开始时间`, icon: 'none' });
        return;
      }
      businessHours[day.key] = [[value.open, value.close]];
    }
    if (!pickupEnabled && !deliveryEnabled) {
      await Taro.showToast({ title: '请至少保留一种履约方式', icon: 'none' });
      return;
    }

    setSaving(true);
    try {
      const updated = await api<Settings>('/store-console/settings', {
        method: 'PATCH',
        body: {
          notice: notice.trim(),
          businessHours,
          pickupEnabled,
          deliveryEnabled,
        },
      });
      setSettings(updated);
      await Taro.showToast({ title: '营业设置已保存', icon: 'success' });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) return <Loading />;

  return (
    <View className="page page--bar">
      <View className="card">
        <View className="row-between">
          <Text className="settings-store">{settings?.name ?? '门店'}</Text>
          <Text className="muted tiny">{settings?.code ?? ''}</Text>
        </View>
      </View>

      <View className="card">
        <Text className="settings-title">营业时间</Text>
        {DAYS.map((day) => {
          const value = hours[day.key];
          return (
            <View className="settings-day" key={day.key}>
              <Text className="settings-day-label">{day.label}</Text>
              <Switch
                checked={value.enabled}
                onChange={(event) => patchDay(day.key, { enabled: event.detail.value })}
              />
              {value.enabled ? (
                <View className="settings-times">
                  <Picker
                    mode="time"
                    value={value.open}
                    onChange={(event) =>
                      patchDay(day.key, { open: String(event.detail.value) })
                    }
                  >
                    <View className="settings-time">
                      <Text>{value.open}</Text>
                    </View>
                  </Picker>
                  <Text className="muted tiny">至</Text>
                  <Picker
                    mode="time"
                    value={value.close}
                    onChange={(event) =>
                      patchDay(day.key, { close: String(event.detail.value) })
                    }
                  >
                    <View className="settings-time">
                      <Text>{value.close}</Text>
                    </View>
                  </Picker>
                </View>
              ) : (
                <Text className="muted tiny settings-rest">休息</Text>
              )}
            </View>
          );
        })}
      </View>

      <View className="card">
        <Text className="settings-title">履约方式</Text>
        <View className="settings-switch-row">
          <View className="col">
            <Text className="small">到店自提</Text>
            <Text className="muted tiny">关闭后小程序不再展示本店自提</Text>
          </View>
          <Switch
            checked={pickupEnabled}
            onChange={(event) => setPickupEnabled(event.detail.value)}
          />
        </View>
        <View className="settings-switch-row">
          <View className="col">
            <Text className="small">同城配送</Text>
            <Text className="muted tiny">关闭后不再接收新的配送单</Text>
          </View>
          <Switch
            checked={deliveryEnabled}
            onChange={(event) => setDeliveryEnabled(event.detail.value)}
          />
        </View>
      </View>

      <View className="card">
        <Text className="settings-title">门店公告</Text>
        <Textarea
          className="settings-notice"
          value={notice}
          maxlength={200}
          placeholder="例如：今日延长营业至 21:00，欢迎到店自提"
          onInput={(event) => setNotice(event.detail.value)}
        />
        <Text className="muted tiny settings-count">{notice.length}/200</Text>
      </View>

      <View className={`card settings-closure${closureActive ? ' is-closed' : ''}`}>
        <View className="row-between">
          <Text className="settings-title settings-title--flush">临时打烊</Text>
          {closureActive && <Text className="settings-closed-tag">打烊中</Text>}
        </View>
        {closureActive ? (
          <>
            <Text className="small settings-closure-tip">
              预计 {new Date(closedUntil!).toLocaleString('zh-CN', { hour12: false })} 恢复营业
            </Text>
            {closureNote ? (
              <Text className="muted tiny">原因：{closureNote}</Text>
            ) : null}
            <View className="settings-closure-actions">
              <View
                className={`settings-closure-btn${closureBusy ? ' is-disabled' : ''}`}
                onClick={() => (closureBusy ? undefined : void reopen())}
              >
                <Text>恢复营业</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <Text className="muted tiny settings-closure-tip">
              打烊期间小程序不再展示本店，已有订单仍可核销与配送
            </Text>
            <View className="settings-durations">
              {CLOSURE_HOURS.map((hour) => (
                <View
                  key={hour}
                  className={`settings-duration${closureHours === hour ? ' active' : ''}`}
                  onClick={() => setClosureHours(hour)}
                >
                  <Text>{hour} 小时</Text>
                </View>
              ))}
            </View>
            <Text className="muted tiny">打烊原因（选填）</Text>
            <Textarea
              className="settings-closure-note"
              value={closureNote}
              maxlength={100}
              placeholder="例如：设备检修，暂停接单"
              onInput={(event) => setClosureNote(event.detail.value)}
            />
            <View
              className={`settings-closure-btn settings-closure-btn--danger${
                closureBusy ? ' is-disabled' : ''
              }`}
              onClick={() => (closureBusy ? undefined : void closeNow())}
            >
              <Text>立即打烊</Text>
            </View>
          </>
        )}
      </View>

      <View className="settings-bar">
        <View
          className={`settings-save${saving ? ' is-disabled' : ''}`}
          onClick={() => (saving ? undefined : void save())}
        >
          <Text>{saving ? '保存中…' : '保存营业设置'}</Text>
        </View>
      </View>
    </View>
  );
}
