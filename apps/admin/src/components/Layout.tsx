import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { getSession, logout, ROLE_LABEL, type AdminRole } from '../auth';
import { ConfirmHost } from './confirm';
import { Toaster } from './toast';

type IconName =
  | 'overview'
  | 'analytics'
  | 'product'
  | 'order'
  | 'customer'
  | 'promotion'
  | 'store'
  | 'decoration'
  | 'settings';

interface MenuItem {
  to: string;
  label: string;
  roles: AdminRole[];
  end?: boolean;
}

interface MenuGroup {
  group: string;
  icon: IconName;
  items: MenuItem[];
}

const ALL: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];

const MENU: MenuGroup[] = [
  {
    group: '经营',
    icon: 'overview',
    items: [
      { to: '/', label: '数据概览', roles: ALL, end: true },
      { to: '/analytics', label: '经营看板', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '商品',
    icon: 'product',
    items: [
      { to: '/products', label: '商品列表', roles: ALL },
      { to: '/categories', label: '分类管理', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/tags', label: '标签管理', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '交易',
    icon: 'order',
    items: [
      { to: '/orders', label: '所有订单', roles: ALL },
      { to: '/orders/batch-ship', label: '批量发货', roles: ['SUPER', 'WMS'] },
      { to: '/after-sales', label: '售后管理', roles: ALL },
      { to: '/reviews', label: '评价管理', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '客户',
    icon: 'customer',
    items: [
      { to: '/customers', label: '客户列表', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/user-tags', label: '用户标签', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/levels', label: '等级规则', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/member-commerce', label: '会员卡与储值', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/points-rules', label: '积分规则', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '营销',
    icon: 'promotion',
    items: [
      { to: '/coupons', label: '优惠券', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/marketing/promotions', label: '满减与秒杀', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '门店履约',
    icon: 'store',
    items: [
      { to: '/settings/stores', label: '门店管理', roles: ALL },
      { to: '/fulfillment/pickups', label: '自提核销', roles: ALL },
      { to: '/fulfillment/deliveries', label: '同城配送', roles: ALL },
    ],
  },
  {
    group: '装修',
    icon: 'decoration',
    items: [
      { to: '/settings/home', label: '页面装修', roles: ['SUPER', 'OPS'] },
      { to: '/settings/home/tabbar', label: '底部导航', roles: ['SUPER', 'OPS'] },
      { to: '/assets', label: '素材库', roles: ['SUPER', 'OPS'] },
    ],
  },
  {
    group: '设置',
    icon: 'settings',
    items: [
      { to: '/settings/shop', label: '店铺信息', roles: ['SUPER'] },
      { to: '/settings/integration', label: '集成配置', roles: ['SUPER'] },
      { to: '/settings/miniapp-release', label: '小程序发布', roles: ['SUPER', 'OPS'] },
      { to: '/settings/freight', label: '运费模板', roles: ALL },
      { to: '/settings/payment', label: '支付设置', roles: ['SUPER'] },
      { to: '/settings/system', label: '系统状态', roles: ['SUPER', 'OPS'] },
      { to: '/settings/express', label: '物流公司', roles: ALL },
      { to: '/accounts', label: '子账号', roles: ['SUPER'] },
      { to: '/logs', label: '操作日志', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
];

const ICON_PATHS: Record<IconName, string[]> = {
  overview: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  analytics: ['M4 19V5', 'M4 19h16', 'M8 16v-5', 'M13 16V8', 'M18 16v-8'],
  product: ['M4 7l8-4 8 4-8 4-8-4z', 'M4 7v10l8 4 8-4V7', 'M12 11v10'],
  order: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
  customer: [
    'M16 19a4 4 0 0 0-8 0',
    'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M20 19a3 3 0 0 0-3-3',
    'M17 11a2.5 2.5 0 1 0 0-5',
  ],
  promotion: ['M4 12l8-8 6 6-8 8H4v-6z', 'M15 7.5h.01'],
  store: ['M4 9l1-5h14l1 5', 'M4 9h16v11H4z', 'M9 20v-6h6v6'],
  decoration: ['M4 4h16v16H4z', 'M4 9h16', 'M9 20V9', 'M13 13h4', 'M13 16h4'],
  settings: ['M4 7h10', 'M18 7h2', 'M14 7a2 2 0 1 0 0 .01', 'M4 17h2', 'M10 17h10', 'M8 17a2 2 0 1 0 0 .01'],
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function isItemActive(pathname: string, item: MenuItem): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** 二级页面没有独立菜单项，用路由覆盖面包屑文案 */
const CRUMB_OVERRIDES: [RegExp, string][] = [
  [/^\/products\/new$/, '新建商品'],
  [/^\/products\/[^/]+\/edit$/, '编辑商品'],
  [/^\/products\/[^/]+\/stock$/, '规格库存'],
  [/^\/orders\/[^/]+$/, '订单详情'],
  [/^\/after-sales\/[^/]+$/, '售后详情'],
  [/^\/customers\/[^/]+$/, '客户详情'],
  [/^\/coupons\/new$/, '新建优惠券'],
  [/^\/coupons\/[^/]+\/claims$/, '领取记录'],
  [/^\/settings\/home\/tabbar$/, '底部导航'],
  [/^\/settings\/home\/legacy$/, '旧版首页设置'],
  [/^\/settings\/home\/[^/]+$/, '编辑微页面'],
];

export function Layout() {
  const session = getSession();
  const location = useLocation();
  const role = session?.role;
  const can = (roles: AdminRole[]) => Boolean(role && roles.includes(role));
  const [userOpen, setUserOpen] = useState(false);

  // 面包屑：取当前路由命中的最长菜单项
  const visibleGroups = MENU.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(item.roles)),
  })).filter((section) => section.items.length > 0);

  let best: { group: string; label: string; length: number } | null = null;
  for (const section of visibleGroups) {
    for (const item of section.items) {
      if (!isItemActive(location.pathname, item)) continue;
      if (!best || item.to.length > best.length) {
        best = { group: section.group, label: item.label, length: item.to.length };
      }
    }
  }
  const activeGroup = best?.group ?? '工作台';
  const override = CRUMB_OVERRIDES.find(([pattern]) => pattern.test(location.pathname))?.[1];
  const activeLabel = override ?? best?.label ?? '数据概览';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="brand-mark" aria-label="山野商城管理后台">
            山
          </span>
        </div>

        <nav className="side-nav" aria-label="主导航">
          {visibleGroups.map((section) => {
            const first = section.items[0];
            const groupActive = section.items.some((item) => isItemActive(location.pathname, item));
            return (
              <div key={section.group} className="rail-item">
                <NavLink
                  to={first.to}
                  className={`rail-btn${groupActive ? ' on' : ''}`}
                  aria-label={section.group}
                  title={section.group}
                >
                  <Icon name={section.icon} />
                </NavLink>
                <div className="rail-flyout">
                  <span className="flyout-title">{section.group}</span>
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => (isActive ? 'flyout-link on' : 'flyout-link')}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs" aria-label="当前位置">
            <span>{activeGroup || '工作台'}</span>
            <span className="crumbs-sep" aria-hidden="true">
              /
            </span>
            <strong>{activeLabel}</strong>
          </div>
          <div className="topbar-user">
            <div className="user-menu">
              <button
                type="button"
                className="user-btn"
                aria-haspopup="menu"
                aria-expanded={userOpen}
                onClick={() => setUserOpen((open) => !open)}
              >
                <span className="user-avatar" aria-hidden="true">
                  {session?.name?.slice(0, 1) ?? '山'}
                </span>
                <span className="user-meta">
                  <strong>{session?.name ?? '未登录'}</strong>
                  <span>{role ? ROLE_LABEL[role] : ''}</span>
                </span>
                <span className="user-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {userOpen && (
                <div className="user-pop" role="menu" onMouseLeave={() => setUserOpen(false)}>
                  <div className="user-pop-head">
                    <strong>{session?.name ?? '未登录'}</strong>
                    <span>{role ? ROLE_LABEL[role] : ''}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-pop-item"
                    onClick={() => {
                      setUserOpen(false);
                      logout();
                    }}
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <Toaster />
      <ConfirmHost />
    </div>
  );
}
