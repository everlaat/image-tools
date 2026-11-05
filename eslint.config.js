import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'crates', 'public/wasm'] },
  js.configs.recommended,

  // Type-aware linting, scoped to TS so plain config files are not pulled
  // into a tsconfig project they do not belong to.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Mask/tensor maths reads far better with plain indexed loops.
      '@typescript-eslint/prefer-for-of': 'off',
      // Interpolating a number into a message is fine and very common here.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['vite.config.ts', 'playwright.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Build scripts run in Node.
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Shipped as-is to the browser and runs in a service worker scope.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },

  // Config files and other plain JS: no type information available.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
