import path from 'node:path';

import { defineConfig } from '@tarojs/cli';

// workspace 包的 TS 源码需要参与编译：app.config 引入 @shanye/tokens，页面从
// '@shanye/shared/src/orderState' 直接引入状态机（dist 为 CJS，避免命名导入失效）
const workspaceSources = [
  path.resolve(__dirname, '../../../packages/shared/src'),
  path.resolve(__dirname, '../../../packages/tokens'),
];

export default defineConfig({
  projectName: 'shanye-miniapp',
  date: '2026-11-06',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {
    // 真机联调时改这里（或在 CI 用环境变量注入）
    API_BASE: JSON.stringify(process.env.API_BASE ?? 'http://127.0.0.1:3000/api'),
  },
  copy: { patterns: [], options: {} },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false },
  },
  cache: { enable: false },
  mini: {
    compile: {
      include: workspaceSources,
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    compile: {
      include: workspaceSources,
    },
    postcss: {
      autoprefixer: { enable: true },
      cssModules: { enable: false },
    },
  },
});
