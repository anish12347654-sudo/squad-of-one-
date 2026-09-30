/**
 * ShopScene (brief section 7): the cosmetic-only shop. Spend the soft currency
 * (Chrono Shards) on echo trails, class colour skins and victory banners; buy +
 * equip through the pure save mutations. No pay-to-win, no loot boxes, no
 * real-money - cosmetics only, priced directly.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave, updateSave } from './save-context.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';
import { COSMETICS, buyCosmetic, equipCosmetic } from '@meta/index.js';
import type { CosmeticCategory } from '@meta/index.js';

export const SCENE_SHOP = 'ui-shop';

const CATEGORIES: CosmeticCategory[] = ['trail', 'skin', 'banner'];

export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_SHOP });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    label(this, cx, 34, 'shop.title', { size: 24, bold: true, name: 'shop-title' });
    label(this, cx, 62, 'shop.balance', {
      size: 14,
      color: UI_COLORS.accent2Text,
      params: { n: getSave().shards },
      name: 'shop-balance',
    });
    label(this, cx, 82, 'shop.cosmeticOnly', { size: 10, color: UI_COLORS.textDim });

    const listX = Math.max(20, cx - 180);
    const listW = Math.min(360, width - 40);
    let y = 110;

    for (const cat of CATEGORIES) {
      label(this, listX, y, `shop.category.${cat}`, { size: 14, bold: true, origin: 0, align: 'left' });
      y += 24;
      for (const c of COSMETICS.filter((x) => x.category === cat)) {
        const save = getSave();
        const owned = save.ownedCosmetics.includes(c.id);
        const equipped = save.equipped[cat] === c.id;
        panel(this, listX, y - 16, listW, 34);
        label(this, listX + 12, y, c.nameKey, { size: 12, origin: 0, align: 'left' });
        if (!owned) {
          label(this, listX + 12, y + 12, 'shop.balance', {
            size: 9,
            color: UI_COLORS.textDim,
            origin: 0,
            align: 'left',
            params: { n: c.price },
          });
        }
        const actKey = equipped ? 'shop.equipped' : owned ? 'shop.equip' : 'shop.buy';
        button(
          this,
          listX + listW - 52,
          y,
          88,
          26,
          actKey,
          () => this.act(c.id, cat, c.price),
          { color: equipped ? UI_COLORS.accent2 : UI_COLORS.accent },
        );
        y += 40;
      }
      y += 6;
    }

    button(this, cx, height - 34, 200, 42, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('shop-ready');
  }

  private act(id: string, cat: CosmeticCategory, price: number): void {
    const save = getSave();
    getAudioEngine().sfx('ui');
    if (save.ownedCosmetics.includes(id)) {
      const next = equipCosmetic(save, cat, id);
      if (next) updateSave(() => next);
    } else {
      const next = buyCosmetic(save, id, price);
      if (next) updateSave(() => next);
    }
    this.scene.restart();
  }
}
