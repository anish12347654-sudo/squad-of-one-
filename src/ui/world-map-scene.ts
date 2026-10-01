/**
 * WorldMapScene (brief section 6.1): the campaign map with per-level stars and
 * linear unlock gates, grouped by world. Each world is a row of compact level
 * nodes; selecting an unlocked node opens the Level Intro. Reads progression
 * from the save; all text is localized. The compact node layout fits all 19
 * levels + 5 worlds on every target viewport (portrait, landscape, tablet).
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave } from './save-context.js';
import { label, button, starPath, UI_COLORS } from './ui-kit.js';
import { mountBackdrop } from './scene-backdrop.js';
import { GLOWS, lighten, darken } from '@game/render/colors.js';
import { CAMPAIGN_LEVELS, WORLDS } from '@content/index.js';
import { levelStatuses, totalStars, maxStars } from '@meta/index.js';
import type { LevelStatus } from '@meta/index.js';

export const SCENE_WORLDMAP = 'ui-worldmap';

export class WorldMapScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_WORLDMAP });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    mountBackdrop(this);

    const save = getSave();
    const statuses = levelStatuses(save, CAMPAIGN_LEVELS);

    label(this, cx, 32, 'map.title', { size: 26, bold: true, display: true, glow: UI_COLORS.accent, name: 'map-title' });
    label(this, cx, 58, 'map.progress', {
      size: 13,
      color: UI_COLORS.accent2Text,
      params: { stars: totalStars(save, CAMPAIGN_LEVELS), max: maxStars(CAMPAIGN_LEVELS) },
    });

    const worlds = WORLDS.filter((w) => CAMPAIGN_LEVELS.some((l) => l.worldId === w.id));
    const top = 84;
    const bottom = height - 70;
    const rowH = Math.min(92, (bottom - top) / worlds.length);
    const listW = Math.min(720, width - 30);
    const listX = cx - listW / 2;
    const node = Math.min(46, rowH * 0.5);

    worlds.forEach((world, wi) => {
      const levels = CAMPAIGN_LEVELS.filter((l) => l.worldId === world.id);
      const y = top + wi * rowH;
      // World header: a tinted bar with a glowing accent edge for depth.
      const hg = this.add.graphics();
      hg.fillStyle(GLOWS.shadow, 0.3);
      hg.fillRoundedRect(listX + 1, y + 2, listW, 20, 6);
      hg.fillStyle(darken(world.palette.accent, 0.55), 0.9);
      hg.fillRoundedRect(listX, y, listW, 20, 6);
      hg.lineStyle(1.5, world.palette.accent, 0.9);
      hg.strokeRoundedRect(listX, y, listW, 20, 6);
      hg.fillStyle(world.palette.accent, 0.9);
      hg.fillRoundedRect(listX, y, 4, 20, 2);
      label(this, listX + 12, y + 10, world.nameKey, { size: 12, bold: true, origin: 0, align: 'left' });

      // Level nodes laid out left-to-right.
      const gap = 8;
      const nx0 = listX + 6;
      const nodeRowY = y + 24 + node / 2 + 6;
      levels.forEach((lvl, li) => {
        const st = statuses.find((s) => s.id === lvl.id)!;
        const nx = nx0 + li * (node + gap) + node / 2;
        this.drawNode(nx, nodeRowY, node, lvl.id, world.palette.accent, st);
      });
    });

    button(this, cx, height - 34, 200, 40, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('worldmap-ready');
  }

  /** A single level node: rounded square, star pips, lock when unavailable. */
  private drawNode(
    cx: number,
    cy: number,
    size: number,
    levelId: string,
    accent: number,
    st: LevelStatus,
  ): void {
    const g = this.add.graphics();
    const half = size / 2;
    const left = cx - half;
    const topY = cy - half;

    // Soft drop shadow lifts the tile off the backdrop.
    g.fillStyle(GLOWS.shadow, 0.4);
    g.fillRoundedRect(left + 1.5, topY + 3, size, size, 8);

    if (st.unlocked) {
      // Accent glow halo + a lit gradient face (lighter top, darker bottom).
      g.fillStyle(accent, 0.18);
      g.fillRoundedRect(left - 2, topY - 2, size + 4, size + 4, 10);
      const steps = 8;
      const bh = size / steps;
      for (let i = 0; i < steps; i++) {
        const tt = i / (steps - 1);
        const c = i === 0 ? lighten(accent, 0.18) : darken(accent, 0.55 + tt * 0.2);
        g.fillStyle(c, 1);
        g.fillRect(left, topY + i * bh, size, bh + 1);
      }
      g.lineStyle(2, lighten(accent, 0.2), 1);
      g.strokeRoundedRect(left, topY, size, size, 8);
    } else {
      // Locked tiles stay dim and low-contrast.
      g.fillStyle(0x121626, 1);
      g.fillRoundedRect(left, topY, size, size, 8);
      g.lineStyle(2, UI_COLORS.panelEdge, 1);
      g.strokeRoundedRect(left, topY, size, size, 8);
    }

    if (st.unlocked) {
      // Three star pips across the bottom of the node.
      const r = size * 0.11;
      const spacing = size * 0.26;
      for (let i = 0; i < 3; i++) {
        const px = cx - spacing + i * spacing;
        const py = cy + half - r - 4;
        g.fillStyle(i < st.bestStars ? UI_COLORS.gold : UI_COLORS.goldEmpty, 1);
        starPath(g, px, py, r, r * 0.45);
        g.fillPath();
      }
      // Level index number near the top of the node.
      label(this, cx, cy - half * 0.4, 'map.node', {
        size: 12,
        bold: true,
        params: { n: st.index + 1 },
      });
      const zone = this.add.zone(cx, cy, size, size).setOrigin(0.5).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.openLevel(levelId));
    } else {
      // Padlock: a small rounded body + shackle arc.
      g.fillStyle(UI_COLORS.panelEdge, 1);
      g.fillRoundedRect(cx - 6, cy - 2, 12, 10, 2);
      g.lineStyle(2, UI_COLORS.panelEdge, 1);
      g.beginPath();
      g.arc(cx, cy - 2, 5, Math.PI, 0, false);
      g.strokePath();
    }
  }

  private openLevel(levelId: string): void {
    getAudioEngine().sfx('ui');
    this.scene.start('ui-levelintro', { levelId });
  }
}
