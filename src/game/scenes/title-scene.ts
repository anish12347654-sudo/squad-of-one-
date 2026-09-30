/**
 * TitleScene - the minimal M0 boot screen.
 *
 * Renders the branding title on a Phaser 4 canvas. Kept intentionally small:
 * later milestones add menus, first-time experience and mode selection. The
 * title text is sourced from the single BRANDING constant.
 */

import Phaser from 'phaser';
import { BRANDING } from '../branding.js';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.cameras.main.setBackgroundColor('#0b0f1a');

    this.add
      .text(cx, cy - 24, BRANDING.title, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '48px',
        color: '#e8ecff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('title-text');

    this.add
      .text(cx, cy + 36, BRANDING.tagline, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#8a93b8',
      })
      .setOrigin(0.5)
      .setName('tagline-text');

    this.add
      .text(cx, cy + 140, 'TAP / PRESS TO ENTER', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#64b5ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('start-prompt');

    const start = (): void => {
      this.scene.start('GameScene');
    };
    this.input.once('pointerdown', start);
    this.input.keyboard?.once('keydown', start);

    // Signal to automated tests (Playwright) that boot completed cleanly.
    this.game.events.emit('title-ready');
  }
}
