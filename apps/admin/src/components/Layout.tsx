import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { getSession, logout, ROLE_LABEL, type AdminRole } from '../auth';
import { getActiveStoreId, setActiveStoreId } from '../store-context';
import { Toaster } from './toast';

interface MenuItem {
  to: string;
  label: string;
  roles: AdminRole[];
  end?: boolean;
}

const ALL: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];

const MENU: { group: string; items: MenuItem[] }[] = [
  { group: '经营', items: [
    { to: '/', label: '数据概览', roles: ALL, end: true },
    { to: '/analytics', label: '经营看板', roles: ['SUPER', 'OPS', 'CS'] },
  ] },
  {
    group: '商品',
    items: [
      { to: '/products', label: '商品列表', roles: ALL },
      { to: '/categories', label: '分类管理', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/tags', label: '标签管理', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '交易',
    items: [
      { to: '/orders', label: '所有订单', roles: [...ALL, 'STORE'] },
      { to: '/orders/batch-ship', label: '批量发货', roles: ['SUPER', 'WMS'] },
      { to: '/after-sales', label: '售后管理', roles: ALL },
      { to: '/reviews', label: '评价管理', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '客户',
    items: [
      { to: '/customers', label: '客户列表', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/levels', label: '等级规则', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/member-commerce', label: '会员卡与储值', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/points-rules', label: '积分规则', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '营销',
    items: [
      { to: '/coupons', label: '优惠券', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/marketing/promotions', label: '满减与秒杀', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '履约',
    items: [
      { to: '/fulfillment/pickups', label: '自提核销', roles: [...ALL, 'STORE'] },
      { to: '/fulfillment/deliveries', label: '同城配送', roles: [...ALL, 'STORE'] },
    ],
  },
  {
    group: '门店',
    items: [
      { to: '/settings/stores', label: '门店管理', roles: [...ALL, 'STORE'] },
    ],
  },
  {
    group: '设置',
    items: [
      { to: '/settings/shop', label: '店铺信息', roles: ['SUPER'] },
      { to: '/settings/integration', label: '集成配置', roles: ['SUPER'] },
      { to: '/settings/miniapp-release', label: '小程序发布', roles: ['SUPER', 'OPS'] },
      { to: '/settings/freight', label: '运费模板', roles: ALL },
      { to: '/settings/payment', label: '支付设置', roles: ['SUPER'] },
      { to: '/settings/system', label: '系统状态', roles: ['SUPER', 'OPS'] },
      { to: '/settings/home', label: '首页运营位', roles: ['SUPER', 'OPS'] },
      { to: '/settings/express', label: '物流公司', roles: ALL },
      { to: '/assets', label: '素材库', roles: ['SUPER', 'OPS'] },
      { to: '/accounts', label: '子账号', roles: ['SUPER'] },
      { to: '/logs', label: '操作日志', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
];

export function Layout() {
  const session = getSession();
  const navigate = useNavigate();
  const location = useLocation();
  const role = session?.role;
  const can = (roles: AdminRole[]) => Boolean(role && roles.includes(role));
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [activeStoreId, setActive] = useState(getActiveStoreId());

  useEffect(() => {
    let alive = true;
    api<{ items: { id: string; name: string }[] }>('/admin/stores/mine')
      .then((result) => {
        if (!alive) return;
        setStores(result.items);
        const stored = getActiveStoreId();
        if (stored && !result.items.some((item) => item.id === stored)) {
          setActiveStoreId('');
          setActive('');
        } else if (!stored && role === 'STORE' && result.items.length > 0) {
          setActiveStoreId(result.items[0].id);
          setActive(result.items[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [role]);

  useEffect(() => {
    if (role === 'STORE' && location.pathname === '/') {
      navigate('/orders', { replace: true });
    }
  }, [role, location.pathname, navigate]);

  function changeStore(storeId: string) {
    setActive(storeId);
    setActiveStoreId(storeId);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="brand-mark">山</span>
          <div>
            <strong>山野商城</strong>
            <span>管理后台</span>
          </div>
        </div>

        <nav className="side-nav">
          {MENU.map((section) => {
            const items = section.items.filter((item) => can(item.roles));
            if (!items.length) return null;
            return (
              <div key={section.group} className="nav-group">
                <span className="nav-group-label">{section.group}</span>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => (isActive ? 'nav-item on' : 'nav-item')}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">运营工作台</div>
          <div className="topbar-user">
            {stores.length > 0 && (
              <select
                className="select"
                style={{ width: 180 }}
                value={activeStoreId}
                aria-label="切换门店"
                onChange={(e) => changeStore(e.target.value)}
              >
                <option value="">全部门店</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            )}
            <div className="who">
              <strong>{session?.name ?? '未登录'}</strong>
              <span>{role ? ROLE_LABEL[role] : ''}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
              回到概览
            </button>
            <button className="btn btn-plain btn-sm" onClick={logout}>
              退出
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
