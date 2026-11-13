import { Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, getToken, showError } from '../../api/client';
import { CirclePostCard, type CirclePostItem } from '../../components/CirclePostCard';
import { Empty, Loading, imageSrc } from '../../components/common';

import './index.css';

interface Profile {
  id: string;
  nickname: string | null;
  avatarKey: string | null;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
}

export default function Page() {
  const router = useRouter();
  const userId = router.params.id ?? '';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<CirclePostItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        const [detail, list] = await Promise.all([
          api<Profile>(`/circle/users/${userId}`, { auth: 'optional' }),
          api<{ items: CirclePostItem[] }>(`/circle/users/${userId}/posts`, { auth: 'optional' }),
        ]);
        setProfile(detail);
        setPosts(list.items);
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const toggleFollow = async () => {
    if (!profile) return;
    if (!getToken()) {
      void Taro.navigateTo({ url: '/pages/login/index' });
      return;
    }
    try {
      const result = await api<{ following: boolean }>(`/circle/users/${profile.id}/follow`, {
        method: profile.isFollowing ? 'DELETE' : 'POST',
      });
      setProfile({
        ...profile,
        isFollowing: result.following,
        followerCount: profile.followerCount + (result.following ? 1 : -1),
      });
    } catch (err) {
      showError(err);
    }
  };

  if (loading) return <Loading />;
  if (!profile) return <Empty text="用户不存在" />;

  return (
    <View className="page page--flush circle-user">
      <View className="circle-user-hero">
        <View className="circle-user-avatar">
          {profile.avatarKey ? (
            <Image className="circle-user-avatar-img" src={imageSrc(profile.avatarKey)} mode="aspectFill" />
          ) : (
            <Text>{(profile.nickname ?? '山').slice(0, 1)}</Text>
          )}
        </View>
        <Text className="circle-user-name">{profile.nickname ?? '山野顾客'}</Text>
        <View className="circle-user-stats">
          <View className="circle-user-stat">
            <Text className="circle-user-stat-value">{profile.postCount}</Text>
            <Text className="muted tiny">内容</Text>
          </View>
          <View className="circle-user-stat">
            <Text className="circle-user-stat-value">{profile.followerCount}</Text>
            <Text className="muted tiny">粉丝</Text>
          </View>
          <View className="circle-user-stat">
            <Text className="circle-user-stat-value">{profile.followingCount}</Text>
            <Text className="muted tiny">关注</Text>
          </View>
        </View>
        {!profile.isSelf && (
          <View
            className={`btn ${profile.isFollowing ? 'btn--ghost' : 'btn--primary'} circle-user-follow`}
            onClick={() => void toggleFollow()}
          >
            {profile.isFollowing ? '已关注' : '关注'}
          </View>
        )}
      </View>

      <View className="circle-user-posts">
        {posts.length === 0 ? (
          <Empty text="还没有发布内容" />
        ) : (
          posts.map((post) => <CirclePostCard key={post.id} post={post} />)
        )}
      </View>
    </View>
  );
}
