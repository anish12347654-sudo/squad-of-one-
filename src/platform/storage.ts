/**
 * Persistence adapter (brief section 9.5): load/save the versioned SaveGame to
 * localStorage, with migration on load and base64 export/import codes.
 *
 * This is the impure boundary between the pure save schema (src/meta/save.ts)
 * and the browser. It degrades gracefully when storage is unavailable (private
 * mode, headless) by keeping an in-memory fallback so gameplay never crashes.
 */

import {
  freshSave,
  migrate,
  exportCode as exportCodePure,
  importCode as importCodePure,
  type SaveGame,
} from '@meta/index.js';

const STORAGE_KEY = 'squad-of-one.save.v1';

/** Base64 encode a UTF-8 string in either Node or the browser. */
export function toBase64(s: string): string {
  if (typeof btoa === 'function') {
    // Encode UTF-8 safely before btoa (which is Latin-1 only).
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  // Node fallback.
  return Buffer.from(s, 'utf-8').toString('base64');
}

/** Base64 decode to a UTF-8 string in either Node or the browser. */
export function fromBase64(s: string): string {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(s, 'base64').toString('utf-8');
}

/** In-memory fallback when localStorage is unavailable. */
let memoryFallback: string | null = null;

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe for a working store (throws in some private modes).
      const k = STORAGE_KEY + '.probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return null;
}

/** Load and migrate the save, or return a fresh one if none/corrupt. */
export function loadSave(): SaveGame {
  const store = storage();
  const raw = store ? store.getItem(STORAGE_KEY) : memoryFallback;
  if (!raw) return freshSave();
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return freshSave();
  }
}

/** Persist a save (already at the current version). */
export function persistSave(save: SaveGame): void {
  const json = JSON.stringify(save);
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, json);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memoryFallback = json;
}

/** Wipe the save (settings/debug). */
export function clearSave(): void {
  const store = storage();
  if (store) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  memoryFallback = null;
}

/** Export the given save as a portable code. */
export function exportSaveCode(save: SaveGame): string {
  return exportCodePure(save, toBase64);
}

/** Import a save code into a migrated SaveGame (throws on garbage). */
export function importSaveCode(code: string): SaveGame {
  return importCodePure(code, fromBase64);
}
