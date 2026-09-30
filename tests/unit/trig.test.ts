import { describe, it, expect } from 'vitest';
import { sin, cos, sinFx, cosFx, wrapAngle, atan2Brads, TRIG_ONE, TRIG_TABLE_SIZE } from '@sim/trig.js';
import { SIN_TABLE } from '@sim/trig-tables.js';

const TWO_PI = Math.PI * 2;
/** Convert a float radian angle to brads for testing against Math.sin. */
const radToBrads = (rad: number): number => Math.round((rad / TWO_PI) * TRIG_TABLE_SIZE);

describe('committed integer trig tables', () => {
  it('the sine table is fully committed with the expected size', () => {
    expect(SIN_TABLE.length).toBe(TRIG_TABLE_SIZE);
    // Anchor points: sin(0)=0, sin(90deg)=+1, sin(180)=0, sin(270)=-1.
    expect(SIN_TABLE[0]).toBe(0);
    expect(SIN_TABLE[TRIG_TABLE_SIZE / 4]).toBe(TRIG_ONE);
    expect(Math.abs(SIN_TABLE[TRIG_TABLE_SIZE / 2] as number)).toBeLessThanOrEqual(1);
    expect(SIN_TABLE[(TRIG_TABLE_SIZE * 3) / 4]).toBe(-TRIG_ONE);
  });

  it('sinFx/cosFx are pure table lookups (values come from SIN_TABLE)', () => {
    for (let i = 0; i < TRIG_TABLE_SIZE; i += 37) {
      expect(sinFx(i)).toBe(SIN_TABLE[i]);
      expect(cosFx(i)).toBe(SIN_TABLE[(i + TRIG_TABLE_SIZE / 4) & (TRIG_TABLE_SIZE - 1)]);
    }
  });

  it('lookups match Math.sin/cos within table tolerance', () => {
    // Tolerance is one table step of angle plus rounding; ~2e-3 is comfortable.
    const tol = 2e-3;
    for (let deg = 0; deg < 360; deg += 3) {
      const rad = (deg / 360) * TWO_PI;
      const brads = radToBrads(rad);
      expect(sin(brads)).toBeCloseTo(Math.sin(rad), 2);
      expect(cos(brads)).toBeCloseTo(Math.cos(rad), 2);
      expect(Math.abs(sin(brads) - Math.sin(rad))).toBeLessThan(tol);
      expect(Math.abs(cos(brads) - Math.cos(rad))).toBeLessThan(tol);
    }
  });

  it('wrapAngle wraps into [0, TRIG_TABLE_SIZE)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(TRIG_TABLE_SIZE)).toBe(0);
    expect(wrapAngle(TRIG_TABLE_SIZE + 5)).toBe(5);
    expect(wrapAngle(-1)).toBe(TRIG_TABLE_SIZE - 1);
  });

  it('lookups are deterministic across repeated calls', () => {
    for (let i = 0; i < 100; i++) {
      expect(sinFx(i)).toBe(sinFx(i));
      expect(cosFx(i)).toBe(cosFx(i));
    }
  });
});

describe('deterministic atan2', () => {
  it('matches Math.atan2 within table resolution across all octants', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [3, 4],
      [-7, 2],
      [5, -9],
      [-2, -11],
    ];
    for (const [y, x] of cases) {
      const brads = atan2Brads(y, x);
      let expected = Math.atan2(y, x);
      if (expected < 0) expected += TWO_PI;
      const expectedBrads = (expected / TWO_PI) * TRIG_TABLE_SIZE;
      // Difference in brads, accounting for wrap-around at the seam.
      let diff = Math.abs(brads - expectedBrads);
      if (diff > TRIG_TABLE_SIZE / 2) diff = TRIG_TABLE_SIZE - diff;
      // atan approximation error < ~0.005 rad -> a handful of brads.
      expect(diff).toBeLessThan(20);
    }
  });

  it('returns 0 for the origin', () => {
    expect(atan2Brads(0, 0)).toBe(0);
  });

  it('is pure/deterministic', () => {
    expect(atan2Brads(3, 7)).toBe(atan2Brads(3, 7));
  });
});
