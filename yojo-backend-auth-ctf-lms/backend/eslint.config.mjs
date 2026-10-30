import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      // Module boundaries (spec ch. 4): feature modules use each other's services, never another module's Prisma models.
      'no-restricted-imports': ['error', { patterns: [{ group: ['../*/*.repository', '../../*/*.repository'], message: 'Use the owning module service, not its repository.' }] }],
    },
  },
  { files: ['test/**/*.ts', 'scripts/**/*.ts', 'prisma/**/*.ts'], rules: { 'no-console': 'off' } },
);
