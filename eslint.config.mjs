import tseslint from 'typescript-eslint';

/**
 * 工程契约静态检查（R2 / R4 / R5）
 * 只拦会导致返工与事故的规则；其余交给团队既定预设。
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', 'coverage/**', '**/prisma/migrations/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message: '禁止裸色值：请引用 packages/tokens。',
        },
        {
          selector: "Property[key.name=/^(fontSize|font-size)$/] > Literal[value=/^\\d+px$/]",
          message: '禁止魔法字号：请使用字阶 token。',
        },
        {
          selector:
            "BinaryExpression[operator='==='] > Literal[value=/^(PENDING_PAYMENT|PAID|SHIPPED|COMPLETED|REFUNDING|REFUNDED|CLOSED)$/]",
          message: '状态判断请使用 packages/shared 的状态机，不要手写比较。',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client'],
              message: '仅 repository / prisma 层可直接使用 Prisma。',
            },
          ],
        },
      ],
    },
  },
  {
    // 例外：token 定义与 Prisma 层本身当然要写色值 / 用 Prisma
    files: ['packages/tokens/**/*', 'apps/api/src/prisma/**/*', 'apps/api/prisma/**/*'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // 测试层需要直接准备/清理夹具，允许使用 Prisma 与状态字面量
    files: ['apps/**/test/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      // 状态机自身需要写状态字面量
      'no-restricted-syntax': 'off',
    },
  },
);
