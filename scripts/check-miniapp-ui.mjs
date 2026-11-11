#!/usr/bin/env node
/**
 * 小程序 UI 规范检查：
 * 1. font-size 只能取 app.css 定义的 8 级刻度（750 设计稿）；
 * 2. 页面与组件样式禁止裸色值（微页面渲染器自带区块调色板，单独豁免）；
 * 违规逐条输出文件与行号，供逐页改造时对账。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'apps/miniapp/src');
const ALLOWED_FONT_SIZES = new Set([20, 22, 24, 28, 30, 34, 40, 48, 64]);
/** 微页面区块调色板：与装修模板一一对应，不走品牌 token */
const HEX_EXEMPT = new Set(['components/MicroRenderer.css']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems = [];

for (const file of walk(SRC)) {
  if (!file.endsWith('.css')) continue;
  const rel = relative(SRC, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const where = `${rel}:${index + 1}`;
    const fontSize = line.match(/font-size:\s*(-?\d+(?:\.\d+)?)px/);
    if (fontSize) {
      const value = Number(fontSize[1]);
      if (!ALLOWED_FONT_SIZES.has(value)) {
        problems.push(`${where} 字号 ${value}px 不在刻度内（20/22/24/28/30/34/40/48/64）`);
      }
    }
    if (!HEX_EXEMPT.has(rel) && /#[0-9a-fA-F]{3,8}\b/.test(line)) {
      problems.push(`${where} 使用了裸色值，请改用 var(--token)`);
    }
  });
}

if (problems.length) {
  console.error(`小程序 UI 规范检查失败，共 ${problems.length} 处：`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('小程序 UI 规范检查通过');
