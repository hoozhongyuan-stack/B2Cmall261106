import { Image, Input, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { tokens } from '@shanye/tokens';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, getToken, showError } from '../../api/client';
import { Empty, Loading, imageSrc } from '../../components/common';
import { money } from '../../utils/format';

import './index.css';

const REPORT_REASONS = ['广告引流', '违法违规', '色情低俗', '人身攻击', '虚假信息', '其他'];

interface Author {
  id: string;
  nickname: string | null;
  avatarKey: string | null;
}

interface PostDetail {
  id: string;
  content: string;
  images: string[];
  author: Author;
  category: { id: string; name: string };
  topics: { id: string; name: string }[];
  products: {
    id: string;
    title: string;
    mainImageKey: string | null;
    priceMinCents: number;
  }[];
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  viewCount: number;
  liked: boolean;
  favorited: boolean;
  followingAuthor: boolean;
  viewerId: string | null;
  isOwner: boolean;
}

interface CommentItem {
  id: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  author: Author;
  replies?: CommentItem[];
}

export default function Page() {
  const router = useRouter();
  const postId = router.params.id ?? '';
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);

  const loadComments = async () => {
    try {
      const result = await api<{ items: CommentItem[] }>(`/circle/posts/${postId}/comments`, {
        auth: 'optional',
      });
      setComments(result.items);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    void (async () => {
      if (!postId) {
        setLoading(false);
        return;
      }
      try {
        const [detail] = await Promise.all([
          api<PostDetail>(`/circle/posts/${postId}`, { auth: 'optional' }),
          loadComments(),
        ]);
        setPost(detail);
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [postId]);

  const toggleLike = async () => {
    if (!post || !getToken()) {
      void Taro.navigateTo({ url: '/pages/login/index' });
      return;
    }
    try {
      const result = await api<{ liked: boolean; likeCount: number }>(
        `/circle/posts/${post.id}/like`,
        { method: post.liked ? 'DELETE' : 'POST' },
      );
      setPost({ ...post, liked: result.liked, likeCount: result.likeCount });
    } catch (err) {
      showError(err);
    }
  };

  const toggleFavorite = async () => {
    if (!post || !getToken()) {
      void Taro.navigateTo({ url: '/pages/login/index' });
      return;
    }
    try {
      const result = await api<{ favorited: boolean; favoriteCount: number }>(
        `/circle/posts/${post.id}/favorite`,
        { method: post.favorited ? 'DELETE' : 'POST' },
      );
      setPost({ ...post, favorited: result.favorited, favoriteCount: result.favoriteCount });
      void Taro.showToast({ title: result.favorited ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (err) {
      showError(err);
    }
  };

  const toggleFollow = async () => {
    if (!post) return;
    if (!getToken()) {
      void Taro.navigateTo({ url: '/pages/login/index' });
      return;
    }
    try {
      const result = await api<{ following: boolean }>(`/circle/users/${post.author.id}/follow`, {
        method: post.followingAuthor ? 'DELETE' : 'POST',
      });
      setPost({ ...post, followingAuthor: result.following });
    } catch (err) {
      showError(err);
    }
  };

  const sendComment = async () => {
    if (!post) return;
    const value = content.trim();
    if (!value) return;
    setSending(true);
    try {
      await api('/circle/comments', {
        method: 'POST',
        body: { postId: post.id, content: value, parentId: replyTo?.id },
      });
      setContent('');
      setReplyTo(null);
      await loadComments();
      setPost((prev) => (prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev));
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (id: string) => {
    const confirmed = await Taro.showModal({ title: '删除评论', content: '删除后不可恢复' });
    if (!confirmed.confirm) return;
    try {
      await api(`/circle/comments/${id}`, { method: 'DELETE' });
      await loadComments();
    } catch (err) {
      showError(err);
    }
  };

  const report = async () => {
    if (!post) return;
    if (!getToken()) {
      void Taro.navigateTo({ url: '/pages/login/index' });
      return;
    }
    try {
      const result = await Taro.showActionSheet({ itemList: REPORT_REASONS });
      const reason = REPORT_REASONS[result.tapIndex];
      await api('/circle/reports', {
        method: 'POST',
        body: { targetType: 'POST', targetId: post.id, reason },
      });
      void Taro.showToast({ title: '已举报，平台会尽快处理', icon: 'none' });
    } catch (err) {
      const message =
        (err as { errMsg?: string }).errMsg ?? (err instanceof Error ? err.message : '');
      if (message.includes('cancel')) return;
      showError(err);
    }
  };

  const preview = (index: number) => {
    if (!post) return;
    void Taro.previewImage({
      current: imageSrc(post.images[index]),
      urls: post.images.map((key) => imageSrc(key)),
    });
  };

  if (loading) return <Loading />;
  if (!post) return <Empty text="内容不存在或已下架" />;

  const canDeleteComment = (comment: CommentItem) =>
    comment.author.id === post.viewerId || post.isOwner;

  return (
    <View className="page page--bar circle-detail">
      <View className="card">
        <View className="row circle-detail-author">
          <View
            className="circle-avatar"
            onClick={() => Taro.navigateTo({ url: `/pages/circle-user/index?id=${post.author.id}` })}
          >
            {post.author.avatarKey ? (
              <Image className="circle-avatar-img" src={imageSrc(post.author.avatarKey)} mode="aspectFill" />
            ) : (
              <Text>{(post.author.nickname ?? '山').slice(0, 1)}</Text>
            )}
          </View>
          <View className="grow col">
            <Text className="circle-author-name">{post.author.nickname ?? '山野顾客'}</Text>
            <Text className="muted tiny">
              {post.category.name}
              {post.topics.length ? ` · ${post.topics.map((topic) => `#${topic.name}`).join(' ')}` : ''}
            </Text>
          </View>
          {!post.isOwner && (
            <View
              className={`btn btn--sm ${post.followingAuthor ? 'btn--ghost' : 'btn--primary'}`}
              onClick={() => void toggleFollow()}
            >
              {post.followingAuthor ? '已关注' : '关注'}
            </View>
          )}
        </View>

        {post.content ? <Text className="circle-detail-content">{post.content}</Text> : null}

        {post.images.length > 0 && (
          <Swiper
            className="circle-detail-swiper"
            indicatorDots={post.images.length > 1}
            indicatorColor="rgba(22, 24, 26, 0.2)"
            indicatorActiveColor={tokens.color.brand}
            circular
          >
            {post.images.map((key, index) => (
              <SwiperItem key={key}>
                <Image
                  className="circle-detail-image"
                  src={imageSrc(key)}
                  mode="aspectFill"
                  onClick={() => preview(index)}
                />
              </SwiperItem>
            ))}
          </Swiper>
        )}

        {post.products.length > 0 && (
          <View className="circle-detail-products">
            <Text className="small muted">相关商品</Text>
            {post.products.map((product) => (
              <View
                key={product.id}
                className="circle-product-row"
                onClick={() => Taro.navigateTo({ url: `/pages/product/index?id=${product.id}` })}
              >
                <Image
                  className="circle-product-thumb"
                  src={imageSrc(product.mainImageKey ?? '')}
                  mode="aspectFill"
                />
                <View className="grow col">
                  <Text className="small ellipsis">{product.title}</Text>
                  <Text className="price tiny">{money(product.priceMinCents)}</Text>
                </View>
                <Text className="muted tiny">去看看 ›</Text>
              </View>
            ))}
          </View>
        )}

        <View className="circle-detail-stats">
          <Text className="muted tiny">浏览 {post.viewCount}</Text>
          <Text className="muted tiny">点赞 {post.likeCount}</Text>
          <Text className="muted tiny">收藏 {post.favoriteCount}</Text>
          <Text className="muted tiny" onClick={() => void report()}>
            举报
          </Text>
        </View>
      </View>

      <View className="card">
        <Text className="section-title circle-comment-title">评论 {post.commentCount}</Text>
        {comments.length === 0 ? (
          <Empty text="还没有评论，来说两句吧" compact />
        ) : (
          comments.map((comment) => (
            <View key={comment.id} className="circle-comment">
              <View className="circle-comment-head">
                <Text className="circle-comment-name">{comment.author.nickname ?? '山野顾客'}</Text>
                <Text className="muted tiny" onClick={() => setReplyTo({ id: comment.id, name: comment.author.nickname ?? '山野顾客' })}>
                  回复
                </Text>
                {canDeleteComment(comment) && (
                  <Text className="muted tiny" onClick={() => void removeComment(comment.id)}>
                    删除
                  </Text>
                )}
              </View>
              <Text className="circle-comment-content">{comment.content}</Text>
              {(comment.replies ?? []).map((reply) => (
                <View key={reply.id} className="circle-reply">
                  <View className="circle-comment-head">
                    <Text className="circle-comment-name">
                      {reply.author.nickname ?? '山野顾客'}
                    </Text>
                    <Text className="muted tiny" onClick={() => setReplyTo({ id: comment.id, name: reply.author.nickname ?? '山野顾客' })}>
                      回复
                    </Text>
                    {(reply.author.id === post.viewerId || post.isOwner) && (
                      <Text className="muted tiny" onClick={() => void removeComment(reply.id)}>
                        删除
                      </Text>
                    )}
                  </View>
                  <Text className="circle-comment-content">{reply.content}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>

      <View className="bottom-bar circle-action-bar">
        <View className={`circle-action${post.liked ? ' circle-action--on' : ''}`} onClick={() => void toggleLike()}>
          {post.liked ? '♥' : '♡'} {post.likeCount}
        </View>
        <View
          className={`circle-action${post.favorited ? ' circle-action--on' : ''}`}
          onClick={() => void toggleFavorite()}
        >
          {post.favorited ? '★' : '☆'} {post.favoriteCount}
        </View>
        <View className="circle-comment-input-wrap">
          {replyTo && (
            <View className="circle-reply-hint">
              <Text className="tiny muted">回复 {replyTo.name}</Text>
              <Text className="tiny" onClick={() => setReplyTo(null)}>
                取消
              </Text>
            </View>
          )}
          <Input
            className="input"
            value={content}
            placeholder={replyTo ? `回复 ${replyTo.name}` : '说点什么…'}
            confirmType="send"
            onInput={(e) => setContent(e.detail.value)}
            onConfirm={() => void sendComment()}
          />
        </View>
        <View
          className={`btn btn--primary btn--sm${sending || !content.trim() ? ' btn--disabled' : ''}`}
          onClick={() => void sendComment()}
        >
          发送
        </View>
      </View>
    </View>
  );
}
