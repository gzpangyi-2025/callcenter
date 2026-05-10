// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Enforce strict typing — forbid explicit `any` usage.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Test files must place imports after jest.mock() calls.
    files: ['**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
    rules: {
      'import/first': 'off',
    },
  },
]);
