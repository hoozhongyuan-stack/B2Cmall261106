/**
 * 设计 token 唯一来源（工程契约 R5）
 * 与 docs/ui/design-system.html v1.2 保持同源：改这里，不要改页面。
 */
export const tokens = {
  color: {
    canvas: '#F6F6F5',
    surface: '#FFFFFF',
    surface2: '#FAFAF9',
    sand: '#F4EFE4',
    ink: '#16181A',
    ink2: '#55585C',
    ink3: '#8E9399',
    line: '#EBEBE8',
    line2: '#DEDEDA',
    brand: '#E2231A',
    brand2: '#C21B14',
    brandSoft: '#FDEDEB',
    gold: '#BC8A2E',
    goldSoft: '#FBF3E2',
    ok: '#1F7A4C',
    warn: '#A9691A',
    danger: '#C22C1E',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { xs: 2, sm: 8, md: 12, lg: 20, pill: 999 },
  text: { display1: 34, display2: 27, title: 17, body: 14, caption: 12, micro: 11 },
  motion: { enter: 200, hover: 320, switch: 200, easing: 'cubic-bezier(.2,.7,.3,1)' },
} as const;

export type Tokens = typeof tokens;
