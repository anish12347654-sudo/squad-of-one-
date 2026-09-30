/**
 * gen-parity-fixture.ts - records the reference per-tick hash sequence for the
 * Node-vs-browser hash-parity gate (brief section 10, gate 2). Writes
 * tests/determinism/parity-fixture.json. Regenerate after any sim/content
 * change that legitimately alters the fingerprint.
 *
 * Run: `tsx scripts/gen-parity-fixture.ts`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runParity, PARITY_LEVEL, PARITY_PLAN } from '../src/content/parity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../tests/determinism/parity-fixture.json');

const result = runParity(PARITY_LEVEL, PARITY_PLAN);
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf-8');
console.log(
  `gen-parity-fixture: ${PARITY_LEVEL} -> ${result.result} on slot ${result.wonOnSlot}, ` +
    `${result.stars}*, finalTick ${result.finalTick}, finalHash ${result.finalHash}, ` +
    `${result.sampleHashes.length} samples -> ${OUT}`,
);
