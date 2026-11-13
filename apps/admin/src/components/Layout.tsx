import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { permissionName, type PermissionKey } from '@shanye/shared/src/permissions';

import { can, getSession, logout, refreshSession } from '../auth';
import { requiredPermission } from '../permissions';
import { ConfirmHost } from './confirm';
import { Toaster } from './toast';

type IconName =
  | 'overview'
  | 'analytics'
  | 'product'
  | 'order'
  | 'customer'
  | 'circle'
  | 'promotion'
  | 'store'
  | 'decoration'
  | 'settings'
  | 'account';

interface MenuItem {
  to: string;
  label: string;
  permission: PermissionKey;
  end?: boolean;
}

interface MenuGroup {
  group: string;
  icon: IconName;
  items: MenuItem[];
}

const MENU: MenuGroup[] = [
  {
    group: '经营',
    icon: 'overview',
    items: [
      { to: '/', label: '数据概览', permission: 'dashboard.view', end: true },
      { to: '/analytics', label: '经营看板', permission: 'analytics.view' },
    ],
  },
  {
    group: '商品',
    icon: 'product',
    items: [
      { to: '/products', label: '商品列表', permission: 'product.view' },
      { to: '/categories', label: '分类管理', permission: 'category.view' },
      { to: '/tags', label: '标签管理', permission: 'tag.view' },
    ],
  },
  {
    group: '交易',
    icon: 'order',
    items: [
      { to: '/orders', label: '所有订单', permission: 'order.view' },
      { to: '/orders/batch-ship', label: '批量发货', permission: 'order.ship' },
      { to: '/after-sales', label: '售后管理', permission: 'aftersale.view' },
      { to: '/reviews', label: '评价管理', permission: 'review.manage' },
    ],
  },
  {
    group: '客户',
    icon: 'customer',
    items: [
      { to: '/customers', label: '客户列表', permission: 'customer.view' },
      { to: '/user-tags', label: '用户标签', permission: 'usertag.view' },
    ],
  },
  {
    group: '圈子',
    icon: 'circle',
    items: [
      { to: '/circle/posts', label: '内容审核', permission: 'circle.audit' },
      { to: '/circle/reports', label: '举报处理', permission: 'circle.audit' },
      { to: '/circle/taxonomy', label: '类目与话题', permission: 'circle.view' },
      { to: '/circle/settings', label: '圈子设置', permission: 'circle.view' },
    ],
  },
  {
    group: '营销',
    icon: 'promotion',
    items: [
      { to: '/coupons', label: '优惠券', permission: 'coupon.view' },
      { to: '/marketing/full-reduction', label: '满减活动', permission: 'promotion.view' },
      { to: '/marketing/seckill', label: '秒杀活动', permission: 'promotion.view' },
      { to: '/marketing/points-mall', label: '积分商城', permission: 'pointsmall.view' },
      { to: '/levels', label: '等级规则', permission: 'level.view' },
      { to: '/members/cards', label: '会员卡', permission: 'membercard.view' },
      { to: '/members/stored-value', label: '储值管理', permission: 'membercard.view' },
      { to: '/points-rules', label: '积分规则', permission: 'points.view' },
    ],
  },
  {
    group: '门店',
    icon: 'store',
    items: [
      { to: '/settings/stores', label: '门店管理', permission: 'store.view' },
      { to: '/fulfillment/pickups', label: '自提核销', permission: 'pickup.verify' },
      { to: '/fulfillment/deliveries', label: '同城配送', permission: 'delivery.manage' },
    ],
  },
  {
    group: '装修',
    icon: 'decoration',
    items: [
      { to: '/settings/home', label: '页面装修', permission: 'micropage.manage' },
      { to: '/settings/home/tabbar', label: '底部导航', permission: 'tabbar.manage' },
      { to: '/settings/home/popup-ads', label: '弹窗广告', permission: 'popupad.manage' },
      { to: '/assets', label: '素材库', permission: 'asset.manage' },
    ],
  },
  {
    group: '设置',
    icon: 'settings',
    items: [
      { to: '/settings/shop', label: '店铺信息', permission: 'shop.manage' },
      { to: '/settings/integration', label: '小程序与支付', permission: 'integration.manage' },
      { to: '/settings/miniapp-release', label: '小程序发布', permission: 'miniapp.view' },
      { to: '/settings/freight', label: '运费模板', permission: 'freight.manage' },
      { to: '/settings/system', label: '系统状态', permission: 'system.view' },
      { to: '/settings/express', label: '物流公司', permission: 'express.view' },
    ],
  },
  {
    group: '账号',
    icon: 'account',
    items: [
      { to: '/accounts', label: '子账号', permission: 'account.view' },
      { to: '/accounts/roles', label: '角色', permission: 'role.view' },
      { to: '/logs', label: '操作日志', permission: 'log.view' },
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
  circle: ['M4 5h16v11H8l-4 4V5z', 'M8 9h8', 'M8 12h5'],
  promotion: ['M4 12l8-8 6 6-8 8H4v-6z', 'M15 7.5h.01'],
  store: ['M4 9l1-5h14l1 5', 'M4 9h16v11H4z', 'M9 20v-6h6v6'],
  decoration: ['M4 4h16v16H4z', 'M4 9h16', 'M9 20V9', 'M13 13h4', 'M13 16h4'],
  settings: ['M4 7h10', 'M18 7h2', 'M14 7a2 2 0 1 0 0 .01', 'M4 17h2', 'M10 17h10', 'M8 17a2 2 0 1 0 0 .01'],
  account: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M4 21a8 8 0 0 1 16 0',
  ],
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
  [/^\/settings\/home\/popup-ads$/, '弹窗广告'],
  [/^\/settings\/home\/[^/]+$/, '编辑微页面'],
  [/^\/settings\/stores\/new$/, '新建门店'],
  [/^\/settings\/stores\/[^/]+\/edit$/, '编辑门店'],
  [/^\/accounts\/roles\/new$/, '新建角色'],
  [/^\/accounts\/roles\/[^/]+\/edit$/, '编辑角色'],
];

function Forbidden({ permission }: { permission: PermissionKey }) {
  return (
    <div className="forbidden">
      <h2>无权限访问</h2>
      <p>
        当前账号缺少权限：<strong>{permissionName(permission)}</strong>
      </p>
      <p className="small muted">如需访问，请联系超级管理员调整角色权限。</p>
      <Link className="btn btn-primary btn-md" to="/">
        返回工作台
      </Link>
    </div>
  );
}

const SIDEBAR_KEY = 'shanye_admin_sidebar_expanded';

export function Layout() {
  const session = getSession();
  const location = useLocation();
  const [userOpen, setUserOpen] = useState(false);
  const [, setRevision] = useState(0);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) return saved === '1';
    return window.innerWidth >= 1280;
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarExpanded ? '1' : '0');
  }, [sidebarExpanded]);

  useEffect(() => {
    void refreshSession().then(() => setRevision((value) => value + 1));
  }, []);

  const roleName = session?.role?.name ?? (session?.isSuper ? '超级管理员' : '未分配角色');

  // 面包屑与菜单：按当前账号权限过滤
  const visibleGroups = MENU.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(item.permission)),
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

  const required = requiredPermission(location.pathname);
  const denied = Boolean(required && !can(required));

  return (
    <div className="app">
      <aside className={`sidebar${sidebarExpanded ? ' sidebar--expanded' : ''}`}>
        <div className="side-brand">
          <span className="brand-mark" aria-label="山野商城管理后台">
            山
          </span>
          <span className="side-brand-name">山野商城</span>
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
                  <span className="rail-label">{section.group}</span>
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

        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarExpanded((value) => !value)}
          aria-label={sidebarExpanded ? '收起侧栏' : '展开侧栏'}
          title={sidebarExpanded ? '收起侧栏' : '展开侧栏'}
        >
          <span aria-hidden="true">{sidebarExpanded ? '«' : '»'}</span>
          <span className="sidebar-toggle-text">收起</span>
        </button>
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
                  <span>{roleName}</span>
                </span>
                <span className="user-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {userOpen && (
                <div className="user-pop" role="menu" onMouseLeave={() => setUserOpen(false)}>
                  <div className="user-pop-head">
                    <strong>{session?.name ?? '未登录'}</strong>
                    <span>{roleName}</span>
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

        <main className="content">{denied && required ? <Forbidden permission={required} /> : <Outlet />}</main>
      </div>

      <Toaster />
      <ConfirmHost />
    </div>
  );
}
