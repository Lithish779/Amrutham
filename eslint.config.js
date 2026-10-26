const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_|next|req|res' }], eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' },
  },
  { ignores: ['node_modules/**', 'coverage/**', 'scripts/load/**'] },
];
