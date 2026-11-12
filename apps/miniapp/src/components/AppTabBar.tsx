import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { tokens } from '@shanye/tokens';
import { useEffect, useState } from 'react';

import type { ShopTabbarConfig, ShopTabbarItem } from '@shanye/shared/src/microPage';
import { imageSrc } from './common';
import { openMicroLink } from '../utils/microLink';
import { cachedShell, loadShell } from '../utils/shopShell';

import './AppTabBar.css';

function currentRoute(): { route: string; options: Record<string, string> } {
  const pages = Taro.getCurrentPages();
  const current = pages[pages.length - 1] as unknown as {
    route?: string;
    options?: Record<string, string>;
  };
  return {
    route: (current?.route ?? '').replace(/^\//, ''),
    options: current?.options ?? {},
  };
}

function isActive(item: ShopTabbarItem, route: string, code: string): boolean {
  const link = item.link;
  if (!link) return false;
  if (link.type === 'page') return route === (link.value ?? '').replace(/^\//, '');
  if (link.type === 'micro') return route === 'pages/micro/index' && code === link.value;
  if (link.type === 'pointsmall') return route === 'pages/points-mall/index';
  return false;
}

export function AppTabBar() {
  const [config, setConfig] = useState<ShopTabbarConfig>(cachedShell().tabbar);
  const [active, setActive] = useState('');

  useEffect(() => {
    // 先用缓存渲染，再强制拉取最新配置（运营改完导航无需等缓存过期）
    void loadShell(true).then((shell) => setConfig(shell.tabbar));
  }, []);

  useDidShow(() => {
    const { route, options } = currentRoute();
    setActive(config.items.find((item) => isActive(item, route, options.code ?? ''))?.key ?? '');
  });

  useEffect(() => {
    const { route, options } = currentRoute();
    setActive(config.items.find((item) => isActive(item, route, options.code ?? ''))?.key ?? '');
  }, [config]);

  if (!config.enabled || config.items.length === 0) return null;

  const style = config.style ?? {};

  function switchTo(item: ShopTabbarItem) {
    if (item.key === active) return;
    const link = item.link;
    if (!link) return;
    if (link.type === 'page' && link.value) {
      void Taro.reLaunch({ url: link.value });
      return;
    }
    if (link.type === 'micro' && link.value) {
      void Taro.reLaunch({ url: `/pages/micro/index?code=${encodeURIComponent(link.value)}` });
      return;
    }
    if (link.type === 'pointsmall') {
      void Taro.reLaunch({ url: '/pages/points-mall/index' });
      return;
    }
    void openMicroLink(link);
  }

  return (
    <>
      <View className="app-tabbar-spacer" />
      <View
        className="app-tabbar"
        style={{
          background: style.background || tokens.color.surface,
          borderTop: style.borderTop === false ? 'none' : '1px solid rgba(0,0,0,0.06)',
        }}
      >
        {config.items.map((item) => {
          const on = item.key === active;
          const color = on
            ? style.selectedColor || tokens.color.brand
            : style.color || tokens.color.ink3;
          const icon = on ? item.activeIconKey || item.iconKey : item.iconKey;
          return (
            <View key={item.key} className="app-tabbar-item" onClick={() => switchTo(item)}>
              {icon ? (
                <Image className="app-tabbar-icon" src={imageSrc(icon)} mode="aspectFit" />
              ) : (
                <View className="app-tabbar-fallback" style={{ color, borderColor: color }}>
                  <Text>{item.text.slice(0, 1)}</Text>
                </View>
              )}
              <Text className="app-tabbar-text" style={{ color }}>
                {item.text}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}
