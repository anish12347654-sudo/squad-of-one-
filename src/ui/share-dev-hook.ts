/**
 * Dev-only share hook (brief section 10, e2e). Exposes the clip exporter +
 * result-card generator on window so Playwright can verify a blob/stream is
 * produced (or the graceful PNG fallback) and a result-card PNG is generated,
 * without depending on the Web Share API being available in headless Chromium.
 *
 * Impure (touches window). Never used by live play.
 */

import type Phaser from 'phaser';
import {
  exportClip,
  renderResultCard,
  canvasToPng,
  shareCapabilities,
  type ResultCardData,
} from '@platform/index.js';
import { getAudioEngine } from '@audio/audio-engine.js';

declare global {
  interface Window {
    __SQUAD_SHARE?: SquadShareGlobal;
  }
}

export interface SquadShareGlobal {
  capabilities(): ReturnType<typeof shareCapabilities>;
  /** Export a short clip of the game canvas; resolves to {method, size, type}. */
  exportClip(durationMs?: number): Promise<{ method: string; size: number; type: string }>;
  /** Render a sample result card PNG; resolves to its byte size. */
  resultCardSize(): Promise<number>;
}

export function installShareDevHook(game: Phaser.Game): void {
  if (typeof window === 'undefined') return;
  const api: SquadShareGlobal = {
    capabilities: () => shareCapabilities(),
    async exportClip(durationMs = 800): Promise<{ method: string; size: number; type: string }> {
      const canvas = game.canvas instanceof HTMLCanvasElement ? game.canvas : null;
      if (!canvas) return { method: 'none', size: 0, type: '' };
      const graph = getAudioEngine().getAudioGraph();
      // A no-op share fn so the exporter takes the download path deterministically.
      const res = await exportClip({
        canvas,
        audioContext: graph?.context ?? null,
        audioSource: graph?.source ?? null,
        durationMs,
        watermark: 'SQUAD OF ONE',
        shareFn: async () => {
          throw new Error('no share in e2e');
        },
      });
      return { method: res.method, size: res.blob.size, type: res.mimeType };
    },
    async resultCardSize(): Promise<number> {
      const data: ResultCardData = {
        title: 'Timeline Secured',
        levelName: 'First Loop',
        stars: 3,
        maxStars: 3,
        rows: [
          { label: 'Echoes alive', value: '2' },
          { label: 'Rewrites', value: '0' },
        ],
        seedText: 'Seed 12345',
        footer: 'SQUAD OF ONE',
        accent: 0x64b5ff,
      };
      const canvas = renderResultCard(data);
      const blob = await canvasToPng(canvas);
      return blob.size;
    },
  };
  window.__SQUAD_SHARE = api;
}
