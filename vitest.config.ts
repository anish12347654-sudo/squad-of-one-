import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
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
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
