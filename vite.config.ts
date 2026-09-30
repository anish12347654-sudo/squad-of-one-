import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// Vite configuration for SQUAD OF ONE.
// - Path aliases mirror the src/ layer layout (see tsconfig.json paths).
// - Web Worker output is emitted as ES modules so the deterministic sim can be
//   hosted in a worker later without changing the build target.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@sim': r('./src/sim'),
      '@content': r('./src/content'),
      '@game': r('./src/game'),
      '@ui': r('./src/ui'),
      '@audio': r('./src/audio'),
      '@meta': r('./src/meta'),
      '@platform': r('./src/platform'),
      '@i18n': r('./src/i18n'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
