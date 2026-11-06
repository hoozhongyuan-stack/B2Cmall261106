import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { getSession, logout, ROLE_LABEL, type AdminRole } from '../auth';
import { Toaster } from './toast';

interface MenuItem {
  to: string;
  label: string;
  roles: AdminRole[];
  end?: boolean;
}

const ALL: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];

const MENU: { group: string; items: MenuItem[] }[] = [
  { group: '经营', items: [{ to: '/', label: '数据概览', roles: ALL, end: true }] },
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
      { to: '/orders', label: '所有订单', roles: ALL },
      { to: '/after-sales', label: '售后管理', roles: ALL },
      { to: '/reviews', label: '评价管理', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '客户',
    items: [
      { to: '/customers', label: '客户列表', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/levels', label: '等级规则', roles: ['SUPER', 'OPS', 'CS'] },
      { to: '/points-rules', label: '积分规则', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
  {
    group: '营销',
    items: [{ to: '/coupons', label: '优惠券', roles: ['SUPER', 'OPS', 'CS'] }],
  },
  {
    group: '设置',
    items: [
      { to: '/settings/shop', label: '店铺信息', roles: ['SUPER'] },
      { to: '/settings/freight', label: '运费模板', roles: ALL },
      { to: '/settings/payment', label: '支付设置', roles: ['SUPER'] },
      { to: '/assets', label: '素材库', roles: ['SUPER', 'OPS'] },
      { to: '/accounts', label: '子账号', roles: ['SUPER'] },
      { to: '/logs', label: '操作日志', roles: ['SUPER', 'OPS', 'CS'] },
    ],
  },
];

export function Layout() {
  const session = getSession();
  const navigate = useNavigate();
  const role = session?.role;
  const can = (roles: AdminRole[]) => Boolean(role && roles.includes(role));

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
