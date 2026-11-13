import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { formatDate } from '../utils/format';
import { imageSrc } from './common';

import './CirclePostCard.css';

export interface CirclePostItem {
  id: string;
  content: string;
  images: string[];
  author: { id: string; nickname: string | null; avatarKey: string | null };
  category: { id: string; name: string };
  topics: { id: string; name: string }[];
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  viewCount: number;
  createdAt: string;
  publishedAt: string | null;
  pinned?: boolean;
  featured?: boolean;
}

/** 圈子内容卡片：信息流、用户主页与我的收藏共用 */
export function CirclePostCard({ post }: { post: CirclePostItem }) {
  const openDetail = () => {
    void Taro.navigateTo({ url: `/pages/circle-detail/index?id=${post.id}` });
  };
  const openAuthor = () => {
    void Taro.navigateTo({ url: `/pages/circle-user/index?id=${post.author.id}` });
  };
  const preview = (index: number) => {
    void Taro.previewImage({
      current: imageSrc(post.images[index]),
      urls: post.images.map((key) => imageSrc(key)),
    });
  };

  const images = post.images.slice(0, 3);

  return (
    <View className="circle-card" onClick={openDetail}>
      <View className="circle-card-head">
        <View className="circle-avatar" onClick={(e) => { e.stopPropagation(); openAuthor(); }}>
          {post.author.avatarKey ? (
            <Image
              className="circle-avatar-img"
              src={imageSrc(post.author.avatarKey)}
              mode="aspectFill"
            />
          ) : (
            <Text>{(post.author.nickname ?? '山').slice(0, 1)}</Text>
          )}
        </View>
        <View className="grow col">
          <Text className="circle-author-name">{post.author.nickname ?? '山野顾客'}</Text>
          <Text className="muted tiny">
            {formatDate(post.publishedAt ?? post.createdAt, true)}
          </Text>
        </View>
        {post.pinned && <Text className="tag tag--gold">置顶</Text>}
        {post.featured && <Text className="tag tag--brand">精选</Text>}
      </View>

      {post.content ? <Text className="circle-card-content">{post.content}</Text> : null}

      {images.length > 0 && (
        <View className={`circle-card-images circle-card-images--${images.length}`}>
          {images.map((key, index) => (
            <View
              key={key}
              className="circle-card-image-wrap"
              onClick={(e) => {
                e.stopPropagation();
                preview(index);
              }}
            >
              <Image className="circle-card-image" src={imageSrc(key)} mode="aspectFill" />
              {index === 2 && post.images.length > 3 && (
                <View className="circle-card-image-more">+{post.images.length - 3}</View>
              )}
            </View>
          ))}
        </View>
      )}

      <View className="circle-card-tags">
        <Text className="tag">{post.category.name}</Text>
        {post.topics.slice(0, 2).map((topic) => (
          <Text key={topic.id} className="tag">
            #{topic.name}
          </Text>
        ))}
      </View>

      <View className="circle-card-foot">
        <Text className="muted tiny">点赞 {post.likeCount}</Text>
        <Text className="muted tiny">评论 {post.commentCount}</Text>
        <Text className="muted tiny">收藏 {post.favoriteCount}</Text>
      </View>
    </View>
  );
}
