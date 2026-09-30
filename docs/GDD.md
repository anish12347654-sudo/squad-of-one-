# SQUAD OF ONE - Game Design Document (concise)

> Working title. This is a living summary of the build brief; it is trimmed to
> what is decided and true today (M0). Later milestones expand the tables.

## Hook

A mobile-first time-loop boss-raid game in which **every member of your raid team
is you**. You fight a boss, die or time out, then replay the encounter - and your
previous attempts run alongside you as recorded past selves. You are the whole
raid: tank, healer, DPS, all recordings of you.

## Pillars

1. **You are the raid.** Every ally is a deterministic replay of a past run.
2. **Readable determinism.** Same inputs always produce the same fight; skill,
   not luck, wins. Replays are exact.
3. **Mobile-first, thumb-friendly.** Portrait 390x844 baseline, touch controls,
   short loops that fit a commute.

## Six differentiators

1. Time-loop co-op where the "team" is your own recorded attempts.
2. Fully deterministic simulation (bit-exact replays, shareable via short codes).
3. No physics engine - hand-written deterministic collision, spatial hash and
   grid pathfinding.
4. Class kit changes what your _recordings_ do, so planning across loops matters.
5. Paradox rules: interacting with your past selves creates tactical constraints.
6. Portable everywhere: PWA + YouTube Playables target, tiny footprint, no
   external calls at runtime.

## Core-loop contracts (frozen intent, implemented across M1+)

- **Fixed 60 Hz tick.** Sim advances in whole ticks; rendering interpolates.
- **InputFrame** is the only thing that drives the sim: `moveX/moveY` (int8),
  `aim` (uint8) + active bit, `buttons` (bitmask).
- **Recording = InputFrame stream** (RLE-compressed typed arrays). A "past self"
  is just its recording re-fed into the same deterministic sim.
- **State hash** (FNV-1a over quantized state) is the determinism fingerprint.

## Classes (M1 shipped subset; table grows in M2)

| Class    | Role   | HP  | Spd | Primary                           | Skill                                  |
| -------- | ------ | --- | --- | --------------------------------- | -------------------------------------- |
| Guardian | Tank   | 400 | 150 | Shield bash, 60u arc, 20/0.6s     | Taunt 4s (cd 8s); takes 30% less dmg   |
| Medic    | Healer | 180 | 190 | Heal beam, lowest-HP% ally <260u  | Sanctuary 110u zone -50% dmg 3s (cd10) |
| Ranger   | DPS    | 160 | 200 | Arrow 520u/s 18/0.35s range 600u  | Piercing Shot 1s charge 120 line (cd7) |

Dash is shared by all classes (~120u over 0.2s, 3s cooldown). The automatic
primary auto-targets the nearest valid target in range. Each class has a
distinct silhouette, colour, sound key and picker blurb (`src/content/classes.ts`).
The loop fantasy: recordings tank/aggro, sustain, or stack DPS while the live
run adds the missing role - you become the whole raid across three slots.

## Content ramp

Tutorial -> early bosses (single mechanic) -> mid bosses (layered mechanics +
paradox rules) -> raid bosses (full squad required). Each level ships with a
recorded bot-solution replay used as a regression test.

## Modes

- **Campaign / boss ladder** (primary).
- **Daily seed** (deterministic shared seed, leaderboard by loops-to-clear).
- **Replay share** (short code encodes seed + input recording).

See `docs/ARCHITECTURE.md` for how these are realized deterministically.
