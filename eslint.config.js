// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Determinism-forbidden Math members. The pure simulation (src/sim/**) may only
 * use the closed-form arithmetic listed in docs/ARCHITECTURE.md; transcendental
 * functions and non-determinism sources are banned so replays stay bit-exact.
 */
const forbiddenMathMembers = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'exp',
  'expm1',
  'log',
  'log2',
  'log10',
  'log1p',
  'pow',
  'cbrt',
  'hypot',
  'sinh',
  'cosh',
  'tanh',
];

const noRestrictedProperties = forbiddenMathMembers.map((property) => ({
  object: 'Math',
  property,
  message: `Math.${property} is forbidden in src/sim (non-deterministic or transcendental). Use committed integer trig tables or closed-form + - * / sqrt.`,
}));

// performance.now() and Date-based timing are wall-clock reads and forbidden.
noRestrictedProperties.push({
  object: 'performance',
  property: 'now',
  message: 'performance.now() is forbidden in src/sim (wall-clock, non-deterministic).',
});

const simDeterminismConfig = {
  name: 'sim/determinism',
  files: ['src/sim/**/*.ts'],
  rules: {
    'no-restricted-properties': ['error', ...noRestrictedProperties],
    'no-restricted-globals': [
      'error',
      { name: 'Date', message: 'Date is forbidden in src/sim (wall-clock, non-deterministic).' },
      { name: 'performance', message: 'performance is forbidden in src/sim (wall-clock).' },
      { name: 'setTimeout', message: 'Timers are forbidden in src/sim (non-deterministic).' },
      { name: 'setInterval', message: 'Timers are forbidden in src/sim (non-deterministic).' },
      { name: 'requestAnimationFrame', message: 'rAF is forbidden in src/sim (render-driven).' },
      { name: 'window', message: 'DOM globals are forbidden in src/sim.' },
      { name: 'document', message: 'DOM globals are forbidden in src/sim.' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date']",
        message: 'new Date() is forbidden in src/sim (wall-clock, non-deterministic).',
      },
      {
        selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
        message: 'Date.now() is forbidden in src/sim (wall-clock, non-deterministic).',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'phaser',
            message: 'Phaser is forbidden in src/sim (rendering engine, non-deterministic).',
          },
        ],
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'Phaser is forbidden in src/sim.' },
          {
            group: ['@game/*', '@ui/*', '@audio/*'],
            message: 'src/sim must not depend on render/ui/audio layers.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'src/sim/trig-tables.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'project/base',
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  simDeterminismConfig,
  {
    // Node/browser tooling files may use DOM/timers/Math freely.
    name: 'project/tooling',
    files: ['scripts/**/*.ts', 'e2e/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Standalone Node ESM capture/showcase scripts: run under Node with
    // Playwright driving a real browser, so Node + browser globals are expected.
    name: 'project/node-scripts',
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-empty': 'off',
    },
  },
);
