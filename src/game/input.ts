/**
 * Input pipeline: turns touch (floating joystick + buttons) and keyboard
 * (WASD/arrows + J/K/L or Space/Shift/E) into a per-frame InputFrame, plus a
 * dev-only hook that feeds tick-exact InputFrames through the SAME pipeline
 * (used by e2e and solution replays).
 *
 * The controller samples continuously; the fixed-timestep runner reads the
 * current InputFrame at each tick boundary. Buttons are edge-or-level depending
 * on the sim (dash/skill are level-checked against cooldowns in the sim, so
 * holding is fine).
 */

import Phaser from 'phaser';
import {
  BUTTON_SKILL,
  BUTTON_DASH,
  BUTTON_INTERACT,
  atan2Brads,
  emptyInput,
} from '@sim/index.js';
import type { InputFrame } from '@sim/index.js';

export interface InputController {
  /** Current sampled input frame. */
  readonly frame: InputFrame;
  /** Called once per rendered frame to refresh `frame` from live devices. */
  sample(): void;
  /** Install a tick-exact scripted frame source (dev hook). */
  setScriptedSource(source: ((tick: number) => InputFrame) | null): void;
  /** The active scripted source, or null for live input. */
  readonly scriptedSource: ((tick: number) => InputFrame) | null;
  /** True when a scripted source is active (e2e/solution replay). */
  readonly scripted: boolean;
  /** Resolve the input for a given sim tick (scripted or live). */
  frameForTick(tick: number): InputFrame;
  destroy(): void;
}

/** Layout for the on-screen touch controls (in the 390x844 base space). */
export interface TouchLayout {
  joyCenterX: number;
  joyCenterY: number;
  joyRadius: number;
  skillX: number;
  skillY: number;
  dashX: number;
  dashY: number;
  interactX: number;
  interactY: number;
  buttonRadius: number;
}

export const DEFAULT_TOUCH_LAYOUT: TouchLayout = {
  joyCenterX: 90,
  joyCenterY: 720,
  joyRadius: 60,
  skillX: 320,
  skillY: 700,
  dashX: 300,
  dashY: 780,
  interactX: 230,
  interactY: 770,
  buttonRadius: 34,
};

interface KeyMap {
  up: Phaser.Input.Keyboard.Key[];
  down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
  skill: Phaser.Input.Keyboard.Key[];
  dash: Phaser.Input.Keyboard.Key[];
  interact: Phaser.Input.Keyboard.Key[];
}

function keysDown(keys: Phaser.Input.Keyboard.Key[]): boolean {
  for (const k of keys) if (k.isDown) return true;
  return false;
}

/** Live joystick state driven by pointer events. */
interface JoyState {
  active: boolean;
  originX: number;
  originY: number;
  curX: number;
  curY: number;
  pointerId: number;
}

export function createInputController(scene: Phaser.Scene, layout: TouchLayout = DEFAULT_TOUCH_LAYOUT): InputController {
  const kb = scene.input.keyboard;
  const K = Phaser.Input.Keyboard.KeyCodes;
  const km: KeyMap | null = kb
    ? {
        up: [kb.addKey(K.W), kb.addKey(K.UP)],
        down: [kb.addKey(K.S), kb.addKey(K.DOWN)],
        left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
        right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
        skill: [kb.addKey(K.J), kb.addKey(K.SPACE)],
        dash: [kb.addKey(K.K), kb.addKey(K.SHIFT)],
        interact: [kb.addKey(K.L), kb.addKey(K.E)],
      }
    : null;

  const joy: JoyState = { active: false, originX: 0, originY: 0, curX: 0, curY: 0, pointerId: -1 };
  const pressed = { skill: false, dash: false, interact: false };

  // --- Touch handling ---
  function inButton(x: number, y: number, bx: number, by: number): boolean {
    const dx = x - bx;
    const dy = y - by;
    return dx * dx + dy * dy <= layout.buttonRadius * layout.buttonRadius * 1.6;
  }

  function onPointerDown(p: Phaser.Input.Pointer): void {
    const x = p.x;
    const y = p.y;
    if (inButton(x, y, layout.skillX, layout.skillY)) {
      pressed.skill = true;
      return;
    }
    if (inButton(x, y, layout.dashX, layout.dashY)) {
      pressed.dash = true;
      return;
    }
    if (inButton(x, y, layout.interactX, layout.interactY)) {
      pressed.interact = true;
      return;
    }
    // Otherwise start a floating joystick where the finger landed (left half).
    if (!joy.active) {
      joy.active = true;
      joy.originX = x;
      joy.originY = y;
      joy.curX = x;
      joy.curY = y;
      joy.pointerId = p.id;
    }
  }

  function onPointerMove(p: Phaser.Input.Pointer): void {
    if (joy.active && p.id === joy.pointerId) {
      joy.curX = p.x;
      joy.curY = p.y;
    }
  }

  function onPointerUp(p: Phaser.Input.Pointer): void {
    if (joy.active && p.id === joy.pointerId) {
      joy.active = false;
      joy.pointerId = -1;
    }
    // Buttons are momentary: release on any up (simple + robust for M1).
    pressed.skill = false;
    pressed.dash = false;
    pressed.interact = false;
  }

  scene.input.on('pointerdown', onPointerDown);
  scene.input.on('pointermove', onPointerMove);
  scene.input.on('pointerup', onPointerUp);
  scene.input.on('pointerupoutside', onPointerUp);

  let scriptedSource: ((tick: number) => InputFrame) | null = null;
  let frame: InputFrame = emptyInput();

  function sampleLive(): InputFrame {
    let mx = 0;
    let my = 0;
    // Joystick vector.
    if (joy.active) {
      const dx = joy.curX - joy.originX;
      const dy = joy.curY - joy.originY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 6) {
        const clamped = Math.min(len, layout.joyRadius) / layout.joyRadius;
        mx = (dx / len) * clamped * 127;
        my = (dy / len) * clamped * 127;
      }
    }
    // Keyboard overrides/augments.
    if (km) {
      let kx = 0;
      let ky = 0;
      if (keysDown(km.left)) kx -= 1;
      if (keysDown(km.right)) kx += 1;
      if (keysDown(km.up)) ky -= 1;
      if (keysDown(km.down)) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const len = Math.sqrt(kx * kx + ky * ky);
        mx = (kx / len) * 127;
        my = (ky / len) * 127;
      }
    }
    let buttons = 0;
    const skill = pressed.skill || (km ? keysDown(km.skill) : false);
    const dash = pressed.dash || (km ? keysDown(km.dash) : false);
    const interact = pressed.interact || (km ? keysDown(km.interact) : false);
    if (skill) buttons |= BUTTON_SKILL;
    if (dash) buttons |= BUTTON_DASH;
    if (interact) buttons |= BUTTON_INTERACT;

    const aim = mx !== 0 || my !== 0 ? (atan2Brads(my, mx) >> 4) & 0xff : 0;
    return {
      moveX: Math.round(mx),
      moveY: Math.round(my),
      aim,
      aimActive: false,
      buttons,
    };
  }

  return {
    get frame(): InputFrame {
      return frame;
    },
    get scripted(): boolean {
      return scriptedSource !== null;
    },
    get scriptedSource(): ((tick: number) => InputFrame) | null {
      return scriptedSource;
    },
    sample(): void {
      if (!scriptedSource) frame = sampleLive();
      else frame = emptyInput();
    },
    frameForTick(tick: number): InputFrame {
      if (scriptedSource) return scriptedSource(tick);
      return frame;
    },
    setScriptedSource(source: ((tick: number) => InputFrame) | null): void {
      scriptedSource = source;
    },
    destroy(): void {
      scene.input.off('pointerdown', onPointerDown);
      scene.input.off('pointermove', onPointerMove);
      scene.input.off('pointerup', onPointerUp);
      scene.input.off('pointerupoutside', onPointerUp);
    },
  };
}
