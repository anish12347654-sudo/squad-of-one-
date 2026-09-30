import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runParity, PARITY_LEVEL, PARITY_PLAN, type ParityResult } from '@content/index.js';

/**
 * Determinism gate 2 (Node side): the committed parity fixture must reproduce
 * exactly when the harness is re-run in Node, AND running it twice must yield
 * identical hashes. The BROWSER side of this gate lives in e2e/parity.spec.ts,
 * which drives the SAME pure harness in real Chromium and asserts the same
 * final + sampled hashes - proving Node-vs-browser hash parity on one replay.
 */

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'parity-fixture.json');

describe('Node-vs-browser hash parity (Node side + fixture)', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as ParityResult;

  it('the committed fixture reproduces exactly in Node', () => {
    const fresh = runParity(PARITY_LEVEL, PARITY_PLAN, fixture.sampleEvery);
    expect(fresh.finalHash).toBe(fixture.finalHash);
    expect(fresh.finalTick).toBe(fixture.finalTick);
    expect(fresh.result).toBe(fixture.result);
    expect(fresh.wonOnSlot).toBe(fixture.wonOnSlot);
    expect(fresh.stars).toBe(fixture.stars);
    expect(fresh.sampleHashes).toEqual(fixture.sampleHashes);
  });

  it('is deterministic across two runs', () => {
    const a = runParity(PARITY_LEVEL, PARITY_PLAN);
    const b = runParity(PARITY_LEVEL, PARITY_PLAN);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.sampleHashes).toEqual(b.sampleHashes);
  });

  it('the fixture level + plan are the ones the browser gate uses', () => {
    expect(fixture.levelId).toBe(PARITY_LEVEL);
    expect(fixture.plan).toEqual(PARITY_PLAN);
  });
});
