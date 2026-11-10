import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { isLoggedIn } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const ProductEdit = lazy(() => import('./pages/ProductEdit'));
const ProductStock = lazy(() => import('./pages/ProductStock'));
const Categories = lazy(() => import('./pages/Categories'));
const Tags = lazy(() => import('./pages/Tags'));
const Orders = lazy(() => import('./pages/Orders'));
const BatchShip = lazy(() => import('./pages/BatchShip'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const AfterSales = lazy(() => import('./pages/AfterSales'));
const AfterSaleDetail = lazy(() => import('./pages/AfterSaleDetail'));
const Reviews = lazy(() => import('./pages/Reviews'));
const Customers = lazy(() => import('./pages/Customers'));
const UserTags = lazy(() => import('./pages/UserTags'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Levels = lazy(() => import('./pages/Levels'));
const PointsRules = lazy(() => import('./pages/PointsRules'));
const Coupons = lazy(() => import('./pages/Coupons'));
const CouponNew = lazy(() => import('./pages/CouponNew'));
const CouponClaims = lazy(() => import('./pages/CouponClaims'));
const ShopSettings = lazy(() => import('./pages/ShopSettings'));
const Integration = lazy(() => import('./pages/Integration'));
const MiniappRelease = lazy(() => import('./pages/MiniappRelease'));
const Freight = lazy(() => import('./pages/Freight'));
const PaymentSettings = lazy(() => import('./pages/PaymentSettings'));
const Assets = lazy(() => import('./pages/Assets'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Logs = lazy(() => import('./pages/Logs'));
const SystemStatus = lazy(() => import('./pages/SystemStatus'));
const HomeLayout = lazy(() => import('./pages/HomeLayout'));
const MicroPages = lazy(() => import('./pages/MicroPages'));
const MicroPageEditor = lazy(() => import('./pages/MicroPageEditor'));
const TabbarSettings = lazy(() => import('./pages/TabbarSettings'));
const ExpressSettings = lazy(() => import('./pages/ExpressSettings'));
const MemberCommerce = lazy(() => import('./pages/MemberCommerce'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Stores = lazy(() => import('./pages/Stores'));
const Pickups = lazy(() => import('./pages/Pickups'));
const Deliveries = lazy(() => import('./pages/Deliveries'));

function Guard({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="table-loading">加载中…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Guard>
              <Layout />
            </Guard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductEdit />} />
          <Route path="products/:id/edit" element={<ProductEdit />} />
          <Route path="products/:id/stock" element={<ProductStock />} />
          <Route path="categories" element={<Categories />} />
          <Route path="tags" element={<Tags />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/batch-ship" element={<BatchShip />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="after-sales" element={<AfterSales />} />
          <Route path="after-sales/:id" element={<AfterSaleDetail />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="customers" element={<Customers />} />
          <Route path="user-tags" element={<UserTags />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="levels" element={<Levels />} />
          <Route path="member-commerce" element={<MemberCommerce />} />
          <Route path="points-rules" element={<PointsRules />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="marketing/promotions" element={<Promotions />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="coupons/new" element={<CouponNew />} />
          <Route path="coupons/:id/claims" element={<CouponClaims />} />
          <Route path="settings/stores" element={<Stores />} />
          <Route path="fulfillment/pickups" element={<Pickups />} />
          <Route path="fulfillment/deliveries" element={<Deliveries />} />
          <Route path="settings/shop" element={<ShopSettings />} />
          <Route path="settings/integration" element={<Integration />} />
          <Route path="settings/miniapp-release" element={<MiniappRelease />} />
          <Route path="settings/freight" element={<Freight />} />
          <Route path="settings/payment" element={<PaymentSettings />} />
          <Route path="settings/system" element={<SystemStatus />} />
          <Route path="settings/home" element={<MicroPages />} />
          <Route path="settings/home/tabbar" element={<TabbarSettings />} />
          <Route path="settings/home/legacy" element={<HomeLayout />} />
          <Route path="settings/home/:id" element={<MicroPageEditor />} />
          <Route path="settings/express" element={<ExpressSettings />} />
          <Route path="assets" element={<Assets />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="logs" element={<Logs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
