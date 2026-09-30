/**
 * gen-icons.ts - generates the PWA icons + Apple touch icon from the brand mark
 * using the pre-installed headless Chromium (Playwright). Writes PNGs into
 * public/icons/ so they are bundled into the build and precached by the offline
 * service worker (zero runtime network calls).
 *
 * Run: `npm run gen:icons`.
 *
 * The mark is the same "time-loop lens" glyph as the favicon in index.html: a
 * ringed core over the deep-space background, drawn as an SVG and rasterised at
 * each size. Maskable variants add safe-zone padding per the PWA maskable spec.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/icons');

const BG = '#0b0f1a';
const RING = '#64b5ff';
const CORE = '#e8ecff';
const ACCENT = '#2b60ff';

/** The brand mark as an SVG string. `pad` is the maskable safe-zone fraction. */
function markSvg(size: number, pad = 0): string {
  const c = size / 2;
  const rOuter = (size / 2) * (1 - pad) * 0.62;
  const rInner = rOuter * 0.32;
  const stroke = Math.max(2, size * 0.045);
  // Three orbiting echo dots to hint "a team of past selves".
  const dots = [0, 120, 240]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const dx = c + Math.cos(a) * rOuter;
      const dy = c + Math.sin(a) * rOuter;
      return `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${(size * 0.05).toFixed(1)}" fill="${ACCENT}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${BG}"/>
  <circle cx="${c}" cy="${c}" r="${rOuter}" fill="none" stroke="${RING}" stroke-width="${stroke}"/>
  ${dots}
  <circle cx="${c}" cy="${c}" r="${rInner}" fill="${CORE}"/>
</svg>`;
}

interface IconSpec {
  file: string;
  size: number;
  pad: number;
}

const ICONS: IconSpec[] = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'maskable-512.png', size: 512, pad: 0.2 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    '/opt/playwright/chromium-1232/chrome-linux64/chrome';
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    for (const spec of ICONS) {
      const svg = markSvg(spec.size, spec.pad);
      const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${svg}</body></html>`;
      await page.setViewportSize({ width: spec.size, height: spec.size });
      await page.setContent(html, { waitUntil: 'load' });
      const el = await page.$('svg');
      if (!el) throw new Error('svg not rendered');
      const buf = await el.screenshot({ omitBackground: true });
      const dest = resolve(OUT_DIR, spec.file);
      writeFileSync(dest, buf);
      console.log(`gen-icons: wrote ${spec.file} (${spec.size}x${spec.size})`);
    }
  } finally {
    await browser.close();
  }
  console.log(`gen-icons: done -> ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error('gen-icons failed:', err);
  process.exitCode = 1;
});
