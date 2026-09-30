/**
 * Share actions (brief section 6.4): UI-facing glue over the platform share
 * layer. Handles exporting a victory clip from the live game canvas, generating
 * a PNG result card, and copying a replay code - all feature-detected with a
 * graceful fallback, and all user-facing text localized.
 */

import Phaser from 'phaser';
import {
  exportClip,
  shareResultCard,
  shareCapabilities,
  type ResultCardData,
} from '@platform/index.js';
import { getAudioEngine } from '@audio/audio-engine.js';
import { t } from '@i18n/index.js';

/** The <canvas> Phaser renders into (for captureStream). */
export function gameCanvas(game: Phaser.Game): HTMLCanvasElement | null {
  const c = game.canvas;
  return c instanceof HTMLCanvasElement ? c : null;
}

/**
 * Export a victory clip from the game canvas, mixing in game audio. Resolves to
 * a short status key for a localized toast. Never throws.
 */
export async function exportVictoryClip(game: Phaser.Game): Promise<string> {
  const canvas = gameCanvas(game);
  if (!canvas) return 'share.unsupported';
  const audio = getAudioEngine();
  const graph = audio.getAudioGraph();
  try {
    const res = await exportClip({
      canvas,
      audioContext: graph?.context ?? null,
      audioSource: graph?.source ?? null,
      durationMs: 2500,
      watermark: t('brand.title'),
      fileName: 'squad-of-one-victory',
    });
    if (res.method === 'png-fallback') return 'share.unsupported';
    return res.method === 'shared' ? 'share.done' : 'share.downloaded';
  } catch {
    return 'share.unsupported';
  }
}

/** Generate + share/download a PNG result card. Never throws. */
export async function exportResultCard(data: ResultCardData): Promise<string> {
  try {
    const res = await shareResultCard(data);
    return res.method === 'shared' ? 'share.done' : 'share.downloaded';
  } catch {
    return 'share.unsupported';
  }
}

/** Copy text (replay code) to the clipboard, best-effort. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Whether clip export can produce a real video here (vs the PNG fallback). */
export function canExportVideo(): boolean {
  const caps = shareCapabilities();
  return caps.canRecord && caps.canCaptureStream;
}
