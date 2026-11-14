import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { saveSession, type AdminSession } from '../auth';
import { Button, Field } from '../components/ui';

interface LoginResult {
  token: string;
  user: AdminSession;
}

interface ShopBrand {
  shopName: string;
  intro: string;
  logoKey: string | null;
}

const DEFAULT_BRAND: ShopBrand = {
  shopName: '山野商城',
  intro: '把山野好物送到每一户人家',
  logoKey: null,
};

export function Login() {
  const navigate = useNavigate();
  // 仅本地开发提供演示账号，生产构建不预填、不展示任何账号信息
  const isDev = import.meta.env.DEV;
  const [account, setAccount] = useState(isDev ? 'admin@shanye.com' : '');
  const [password, setPassword] = useState(isDev ? 'admin123' : '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 品牌区信息来自「店铺设置」，登录页无需鉴权即可读取
  const [brand, setBrand] = useState<ShopBrand>(DEFAULT_BRAND);

  useEffect(() => {
    api<ShopBrand>('/shop')
      .then((shop) =>
        setBrand({
          shopName: shop.shopName || DEFAULT_BRAND.shopName,
          intro: shop.intro || DEFAULT_BRAND.intro,
          logoKey: shop.logoKey ?? null,
        }),
      )
      .catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api<LoginResult>('/admin/auth/login', {
        method: 'POST',
        body: { account: account.trim(), password },
      });
      saveSession(result.token, result.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <aside className="login-hero">
        <div className="row">
          {brand.logoKey ? (
            <span className="brand-mark brand-mark--image">
              <img src={assetPreviewUrl(brand.logoKey)} alt={brand.shopName} />
            </span>
          ) : (
            <span className="brand-mark">{brand.shopName.slice(0, 1)}</span>
          )}
          <strong>{brand.shopName}</strong>
        </div>
        <div>
          <h1>{brand.intro}</h1>
          <p>商品、订单、售后与会员经营，都在同一张工作台上完成。</p>
        </div>
        <span className="small">商家运营后台 · 请使用分配给你的账号登录</span>
      </aside>

      <div className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2>登录后台</h2>
          <p>使用商家账号进入运营工作台</p>
          {error && <div className="login-error">{error}</div>}
          <Field label="账号">
            <input
              className="input"
              value={account}
              autoComplete="username"
              placeholder="请输入登录账号"
              onChange={(e) => setAccount(e.target.value)}
            />
          </Field>
          <Field label="密码">
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={loading}>
            登录
          </Button>
          {isDev && (
            <p className="login-hint">
              本地演示账号：admin@shanye.com / admin123（超管）
              <br />
              ops@shanye.com / ops12345（商品运营）
              <br />
              cs@shanye.com / cs123456（客服）
              <br />
              wms@shanye.com / wms12345（仓储）
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default Login;
