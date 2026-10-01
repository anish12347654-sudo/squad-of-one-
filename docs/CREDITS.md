# Credits

## Engine & tooling

- **Phaser 4** (MIT) - rendering engine. https://phaser.io
- **Vite** (MIT) - build tooling.
- **TypeScript** (Apache-2.0).
- **Vitest** (MIT) - unit/determinism tests.
- **Playwright** (Apache-2.0) - end-to-end tests and screenshots.
- **ESLint** (MIT) + **typescript-eslint** (MIT) + **Prettier** (MIT).

## Techniques

- Fixed-timestep accumulator loop after Glenn Fiedler's "Fix Your Timestep".
- Deterministic lockstep principles after Glenn Fiedler's "Deterministic
  Lockstep".
- sfc32 / mulberry32 PRNGs (public-domain small PRNGs).
- FNV-1a hash (public domain).

## Fonts

The game bundles three fonts, subsetted to only the glyphs it renders (Latin +
the specific Devanagari used by the Hindi UI + a Latin headline face). All are
licensed under the **SIL Open Font License, Version 1.1** (OFL-1.1):

- **Noto Sans** - Copyright 2022 The Noto Project Authors
  (https://github.com/notofonts/latin-greek-cyrillic). Used for English / Latin
  text. Shipped as `public/fonts/NotoSans-subset.woff2`.
- **Noto Sans Devanagari** - Copyright 2022 The Noto Project Authors
  (https://github.com/notofonts/devanagari). Used for Hindi / Devanagari text.
  Shipped as `public/fonts/NotoSansDevanagari-subset.woff2`.
- **Orbitron** - Copyright 2018 The Orbitron Project Authors
  (https://github.com/theleagueof/orbitron). A geometric sci-fi display face
  used for the Latin title/headlines only (Hindi headlines fall back to Noto
  Sans Devanagari). The upstream variable font is instanced to a single bold
  weight and subsetted. Shipped as `public/fonts/Orbitron-subset.woff2`.

The full OFL-1.1 license text is included in `public/fonts/OFL.txt`. The subsets
are produced by `scripts/subset-fonts.py` (fontTools) from the upstream hinted
TTFs; regenerating them requires network access to download the source fonts.

## Art / audio

- Audio is fully procedural (WebAudio synthesis); no external audio assets.
- VFX and UI shapes are drawn procedurally by Phaser; no external art assets yet.

_All third-party assets shipped in the game are listed here with their licenses._
