import { Image, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, ensureLogin, getToken, showError } from '../../api/client';
import { Loading, imageSrc } from '../../components/common';

import './index.css';

interface Profile {
  nickname: string | null;
  avatarKey: string | null;
}

export default function Page() {
  const [nickname, setNickname] = useState('');
  const [avatarKey, setAvatarKey] = useState('');
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await api<Profile>('/member/profile');
        setNickname(profile.nickname ?? '');
        setAvatarKey(profile.avatarKey ?? '');
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pickAvatar = async () => {
    try {
      const result = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      const filePath = result.tempFilePaths[0];
      if (!filePath) return;
      setUploading(true);
      await ensureLogin();
      const token = getToken();
      const res = await Taro.uploadFile({
        url: `${API_BASE}/member/avatar`,
        filePath,
        name: 'file',
        header: token ? { authorization: `Bearer ${token}` } : {},
      });
      const body = JSON.parse(res.data) as {
        data?: { key: string };
        message?: string;
      };
      if (res.statusCode < 200 || res.statusCode >= 300 || !body.data?.key) {
        throw new Error(body.message || '头像上传失败');
      }
      setAvatarKey(body.data.key);
      setPreview(filePath);
    } catch (err) {
      const message =
        (err as { errMsg?: string }).errMsg ?? (err instanceof Error ? err.message : '');
      if (!message.includes('cancel')) showError(err);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const value = nickname.trim();
    if (!value) {
      await Taro.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    setSaving(true);
    try {
      await api('/member/profile', {
        method: 'PATCH',
        body: { nickname: value, avatarKey: avatarKey || null },
      });
      await Taro.showToast({ title: '资料已保存', icon: 'success' });
      setTimeout(() => {
        void Taro.navigateBack();
      }, 600);
    } catch (err) {
      showError(err);
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  const avatarSrc = preview || (avatarKey ? imageSrc(avatarKey) : '');

  return (
    <View className="page page--bar profile-page">
      <View className="card profile-avatar-card">
        <View className="profile-avatar" onClick={() => void pickAvatar()}>
          {avatarSrc ? (
            <Image className="profile-avatar-img" src={avatarSrc} mode="aspectFill" />
          ) : (
            <Text className="profile-avatar-text">{(nickname || '山').slice(0, 1)}</Text>
          )}
          <View className="profile-avatar-mask">{uploading ? '上传中…' : '更换头像'}</View>
        </View>
        {avatarKey && !uploading && (
          <Text className="tiny profile-reset" onClick={() => { setAvatarKey(''); setPreview(''); }}>
            恢复默认头像
          </Text>
        )}
      </View>

      <View className="card">
        <Text className="section-title profile-title">昵称</Text>
        <Input
          className="input"
          value={nickname}
          maxlength={20}
          placeholder="给自己取个名字"
          onInput={(e) => setNickname(e.detail.value)}
        />
        <Text className="muted tiny profile-hint">最多 20 个字符，展示在圈子、评价等互动场景</Text>
      </View>

      <View className="bottom-bar">
        <View
          className={`btn btn--primary btn--block${saving || uploading ? ' btn--disabled' : ''}`}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </View>
      </View>
    </View>
  );
}
