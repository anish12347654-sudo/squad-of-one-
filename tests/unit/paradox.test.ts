import { describe, it, expect } from 'vitest';
import {
  createLevelState,
  step,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  emptyInput,
  countAliveNonParadoxEchoes,
  PARADOX_DIVERGE_TICKS,
  type EchoRecordingMeta,
  type InputFrame,
  type SimState,
  type LevelDef,
} from '@sim/index.js';

const SECOND = 60;

/** A tiny arena with two slots and a placed shard for anchor tests. */
const PARADOX_ARENA: LevelDef = {
  id: 'paradox-arena',
  halfWidth: 500,
  halfHeight: 500,
  loopLength: 10 * SECOND,
  slotCount: 2,
  spawns: [
    { x: -100, y: 200, facing: 3072 },
    { x: 100, y: 200, facing: 3072 },
  ],
  boss: {
    x: 0,
    y: -200,
    maxHp: 5000,
    radius: 46,
    speed: 0,
    phaseThreshold: 0.5,
    pattern: [
      { shape: 'slam', telegraphTicks: 600, activeTicks: 2, recoveryTicks: 600, radius: 10, halfArc: 0, damage: 0, maxHpFraction: 1 },
    ],
  },
  starEchoesAlive: 1,
  interactables: [{ kind: 'shard', x: 0, y: 200, radius: 40 }],
};

function makeState(recordingSlot: number, classes = ['guardian', 'guardian'] as const): SimState {
  setBossPattern(PARADOX_ARENA.boss.pattern);
  return createLevelState(PARADOX_ARENA, recordingSlot, classes.slice() as never, true);
}

function echoUnit(state: SimState, slot: number) {
  return state.units.find((u) => u.kind === 'echo' && u.slot === slot);
}

describe('paradox: path divergence (contract 3.4)', () => {
  it('triggers after exactly 20 consecutive diverged ticks (>12u)', () => {
    // Slot 0 recording: it stays put at (-100,200) the whole loop.
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(-100, 200);
    const rec: EchoRecordingMeta = { positions, anchors: [], length };

    // We record slot 1 live (so slot 0 is the echo). But we force slot 0's echo
    // to diverge by teleporting it far from its recorded path each tick.
    const state = makeState(1);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);

    let triggeredAt = -1;
    for (let t = 0; t < 40; t++) {
      const echo = echoUnit(state, 0)!;
      // Move the echo 100u off its recorded (-100,200) so divergence > 12u.
      echo.x = 200;
      echo.y = 200;
      setEchoInputs(new Map<number, InputFrame>());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
      const after = echoUnit(state, 0)!;
      if (after.paradox && triggeredAt < 0) triggeredAt = state.tick;
    }
    // detectParadox increments divergedTicks each tick; at the 20th it triggers.
    expect(triggeredAt).toBe(PARADOX_DIVERGE_TICKS);
  });

  it('does NOT trigger when the echo stays within 12u of its path', () => {
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(-100, 200);
    const rec: EchoRecordingMeta = { positions, anchors: [], length };
    const state = makeState(1);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);
    for (let t = 0; t < 40; t++) {
      const echo = echoUnit(state, 0)!;
      echo.x = -100 + 5; // within tolerance
      echo.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
    }
    expect(echoUnit(state, 0)!.paradox).toBe(false);
  });

  it('resets the diverged counter when the echo returns within tolerance', () => {
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(-100, 200);
    const rec: EchoRecordingMeta = { positions, anchors: [], length };
    const state = makeState(1);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);
    for (let t = 0; t < 60; t++) {
      const echo = echoUnit(state, 0)!;
      // Diverge for 10 ticks, snap back for 1, repeat: never 20 in a row.
      echo.x = t % 11 === 10 ? -100 : 200;
      echo.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
    }
    expect(echoUnit(state, 0)!.paradox).toBe(false);
  });
});

describe('paradox: anchor broken (contract 3.4)', () => {
  it('triggers when a recorded shard pickup is taken by another slot within +/-5 ticks', () => {
    const length = PARADOX_ARENA.loopLength;
    // Slot 0 recorded taking the shard (defIndex 0) at tick 30.
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(0, 200); // sits on the shard
    const rec: EchoRecordingMeta = { positions, anchors: [{ objectId: 0, tick: 30 }], length };

    const state = makeState(1);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);
    // Simulate another slot (the live slot 1) having already taken the shard.
    state.interactables[0]!.taken = true;
    state.interactables[0]!.takenBySlot = 1;
    state.interactables[0]!.takenAtTick = 5;

    let triggered = false;
    let cause = '';
    for (let t = 0; t < 40; t++) {
      const echo = echoUnit(state, 0)!;
      echo.x = 0; // stay on path so only the anchor can fire
      echo.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
      if (echoUnit(state, 0)!.paradox && !triggered) {
        triggered = true;
        cause = state.paradoxEvents[state.paradoxEvents.length - 1]!.detail;
      }
    }
    expect(triggered).toBe(true);
    expect(cause).toContain('Slot 2'); // taken by slot index 1 -> "Slot 2"
  });

  it('does not trigger from an anchor outside the +/-5 tick window', () => {
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(0, 200);
    // Anchor recorded at tick 300, far outside the ticks we simulate.
    const rec: EchoRecordingMeta = { positions, anchors: [{ objectId: 0, tick: 300 }], length };
    const state = makeState(1);
    state.interactables[0]!.taken = true;
    state.interactables[0]!.takenBySlot = 1;
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);
    for (let t = 0; t < 40; t++) {
      const echo = echoUnit(state, 0)!;
      echo.x = 0;
      echo.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
    }
    expect(echoUnit(state, 0)!.paradox).toBe(false);
  });
});

describe('paradox: hostility, inversion, and alive counts', () => {
  it('a paradox echo becomes team enemy and is excluded from alive counts', () => {
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(-100, 200);
    const rec: EchoRecordingMeta = { positions, anchors: [], length };
    const state = makeState(1);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);
    expect(countAliveNonParadoxEchoes(state)).toBe(1);
    for (let t = 0; t < 25; t++) {
      const echo = echoUnit(state, 0)!;
      echo.x = 300;
      echo.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
    }
    const echo = echoUnit(state, 0)!;
    expect(echo.paradox).toBe(true);
    expect(echo.team).toBe('enemy');
    // Paradox echoes do NOT count as alive for stars/Avatar.
    expect(countAliveNonParadoxEchoes(state)).toBe(0);
  });

  it('a paradox Medic drains (support inversion) rather than heals', () => {
    // Slot 0 is a paradox Medic; slot 1 is a live Guardian nearby.
    const length = PARADOX_ARENA.loopLength;
    const positions: number[] = [];
    for (let t = 0; t < length; t++) positions.push(-100, 200);
    const rec: EchoRecordingMeta = { positions, anchors: [], length };
    setBossPattern(PARADOX_ARENA.boss.pattern);
    const state = createLevelState(PARADOX_ARENA, 1, ['medic', 'guardian'], true);
    const echoMeta = new Map<number, EchoRecordingMeta>([[0, rec]]);

    // Place the live Guardian in the paradox Medic's drain range.
    const live = state.units.find((u) => u.kind === 'player')!;
    const medic = echoUnit(state, 0)!;
    const hpBefore = live.hp;
    // Run past the paradox trigger (20 ticks) AND the 0.5s glitch telegraph.
    for (let t = 0; t < 80; t++) {
      medic.x = 300; // force divergence -> paradox
      medic.y = 200;
      live.x = 320;
      live.y = 200;
      setEchoInputs(new Map());
      setEchoRecordings(echoMeta);
      step(state, emptyInput());
    }
    expect(medic.paradox).toBe(true);
    // The live guardian should have LOST hp to the drain (never gained).
    expect(live.hp).toBeLessThan(hpBefore);
  });
});
