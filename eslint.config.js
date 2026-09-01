const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const importPlugin = require('eslint-plugin-import');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/.nyc_output/**',
      '**/public/**',
    ],
  },
  js.configs.recommended,
  prettier, // disable stylistic rules that conflict with Prettier
  // shared workspace (CommonJS, used by both server and client)
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { eqeqeq: ['error', 'smart'] },
  },
  // server workspace (CommonJS, Node)
  {
    files: ['server/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // server tests + test support files (jest globals)
  {
    files: [
      'server/**/*.test.js',
      'server/testing/**/*.js',
      'server/test-setup.js',
      'server/test-utils.js',
    ],
    languageOptions: { globals: { ...globals.jest } },
  },
  // client workspace (React, JSX, ES modules)
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      parser: require('@babel/eslint-parser'),
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['@babel/preset-react'] },
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
    },
    plugins: { react: react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y, import: importPlugin },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 18 + CRA auto-JSX
      'react/prop-types': 'off', // DECIDED: codebase has 0 prop-types usage
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn', // DECIDED: start as warn (P2-12 large useCallback deps)
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // client tests + test support files (jest + node globals; tests use `global`/`require`)
  {
    files: [
      'client/**/*.{test,spec}.{js,jsx}',
      'client/src/testing/**/*.js',
      'client/src/setupTests.js',
      'client/src/jest-polyfills.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  // CRA dev proxy (CommonJS, runs in Node)
  {
    files: ['client/src/setupProxy.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
  },
  // root-level tooling and e2e helpers (Node)
  {
    files: ['scripts/**/*.{js,mjs}', 'e2e/**/*.{cjs,mjs}', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
];
