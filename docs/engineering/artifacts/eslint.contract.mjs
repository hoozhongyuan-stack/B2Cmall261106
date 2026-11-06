/**
 * 工程契约 ESLint 规则（R2 / R4 / R5）
 * 用法：复制本文件的 rules 片段，合并进仓库根目录的 eslint.config.mjs。
 * 只覆盖「会导致返工或事故」的规则，风格问题交给既定预设。
 */
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-syntax': [
        'error',

        // R5 · 禁止裸色值（十六进制与 rgb/rgba），必须使用 packages/tokens
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message: '禁止裸色值：请引用 packages/tokens（如 var(--brand)）。',
        },
        {
          selector: "Literal[value=/^rgba?\\\\(/]",
          message: '禁止裸 rgb/rgba 色值：请引用 packages/tokens。',
        },

        // R5 · 禁止魔法字号（font-size: 13px 这类）
        {
          selector: "Property[key.name=/^(fontSize|font-size)$/] > Literal[value=/^\\\\d+px$/]",
          message: '禁止魔法字号：请使用字阶 token（如 var(--text-body)）。',
        },

        // R4 · 原生 SQL 只允许出现在 repository 层
        {
          selector: "CallExpression[callee.property.name='$queryRaw']",
          message: '原生查询仅允许在 repository 层，业务规则不要绕过 ORM。',
        },

        // R4 · 禁止在业务层复制状态判断（形如 status === 'PAID' 硬编码迁移）
        {
          selector:
            "BinaryExpression[operator='==='] > Literal[value=/^(PENDING_PAYMENT|PAID|SHIPPED|COMPLETED|REFUNDING|REFUNDED|CLOSED)$/]",
          message: '状态迁移请调用 packages/shared 的 can(action, from)，不要手写判断。',
        },
      ],

      // R4 · Prisma 仅允许在 repository / prisma 目录使用
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@prisma/client/*'],
              message: '仅 repository 层可直接使用 Prisma，业务层请调用 Repository。',
            },
            {
              group: ['**/apps/api/src/prisma/*'],
              message: '禁止跨层直接引用 Prisma 实例。',
            },
          ],
        },
      ],
    },
  },

  // 例外：tokens 定义文件本身允许写色值；repository 层允许用 Prisma
  {
    files: ['packages/tokens/**/*.{ts,tsx,css}', 'apps/api/src/**/repository/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
];
