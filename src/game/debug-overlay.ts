/**
 * Dev-only debug overlay (brief 9.2): shows the current tick, the determinism
 * state hash, FPS, and the live entity count. It is instantiated by the
 * GameScene ONLY under the compile-time `__DEV_TOOLS__` flag, so the release
 * build tree-shakes this whole module out of the shipped bundle (verified by
 * scripts/check-prod-bundle.ts). The hash is recomputed off the render path and
 * never affects the sim.
 */

import type Phaser from 'phaser';
import { hashState, type SimState } from '@sim/index.js';

export class DebugOverlay {
  private text: Phaser.GameObjects.Text;
  private accum = 0;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(6, 6, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#7CFC98',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 4, y: 3 },
      })
      .setOrigin(0, 0)
      .setDepth(60)
      .setScrollFactor(0);
  }

  reposition(): void {
    this.text.setPosition(6, 6);
  }

  /** Update ~4 Hz with tick / hash / fps / entity count. */
  update(deltaMs: number, state: SimState, fps: number, resScale: number, phase: string): void {
    this.accum += deltaMs;
    if (this.accum < 250) return;
    this.accum = 0;
    const hash = hashState(state) >>> 0;
    const entities = state.units.length + state.projectiles.length + state.attacks.length;
    this.text.setText(
      `tick ${state.tick}\n` +
        `hash ${hash.toString(16).padStart(8, '0')}\n` +
        `fps ${Math.round(fps)}  res ${resScale.toFixed(2)}\n` +
        `ents ${entities} (${state.units.length}u/${state.projectiles.length}p/${state.attacks.length}a)\n` +
        `phase ${phase}`,
    );
  }

  destroy(): void {
    this.text.destroy();
  }
}
