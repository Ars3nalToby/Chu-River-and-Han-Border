# 楚河漢界 · Night of Chu and Han — cinematic 3D Xiangqi

A browser Xiangqi (Chinese chess) game set on an ancient battlefield altar during the Chu–Han war
(c. 206–202 BC). A real river flows through the middle of the board; every piece is a lacquered disc
carved with calligraphy, carrying a procedural Qin-terracotta warrior; moves are marched, captures are
choreographed (strike → hit-stop → shatter), the cannon fires a shell over its screen piece, and the
defeated general topples as a seal stamp and a rice-paper scroll declare the winner.

Vite + TypeScript (vanilla) · three.js 0.170 · pmndrs `postprocessing` · plain DOM HUD · no physics engine
(all motion is hand-authored with easing) · all audio synthesised with WebAudio (no sound files).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm test           # rules / perft / notation / AI / oracle tests
```

URL flags for debugging: `?q=low|high|ultra`, `?lang=zh|en`, `?ai=0` (two players), `?classic=1`,
`?fast=1` (skip the entrance), `?slow=1` (cap frame delta higher — handy under software rendering).

## Rules module and proof (milestone 1)

`src/game/rules.ts` is a pure-TypeScript implementation (no Three.js / DOM imports): general with palace
and flying-general rule, advisors, elephants (eye + river limit), horses (leg), chariots, cannons
(exactly one screen), soldiers, legality by make/unmake, 困毙 = **loss**, threefold repetition = draw.

```
perft(1) = 44         (2 ms)
perft(2) = 1,920      (7 ms)
perft(3) = 79,666     (30 ms)
perft(4) = 3,290,240  (427 ms)
```

Unit tests cover flying general, horse-leg block, elephant-eye block, elephant river limit, cannon capture
with 0 / 1 / 2 screens, soldier sideways only after the river, palace confinement, check detection, 困毙
counted as a loss, checkmate, and repetition.

As an extra safeguard `src/game/oracle.test.ts` cross-checks the rules module against **Fairy-Stockfish
(WASM)** used purely as a test oracle: 12 random games, per-root-move `perft(2)` splits compared on
**200 mid-game positions (261,503 nodes) — identical**.

### Repetition rule caveat
Only the simplified rule is implemented: the same position (with the same side to move) occurring three
times is a draw. The official perpetual-check / perpetual-chase rulings are **not** implemented
(a perpetual checker is not forced to deviate, and no side is declared the loser for perpetual chasing).
There is no 60-move no-capture rule either.

## AI — which engine and why

I evaluated `fairy-stockfish-nnue.wasm` (it does support `UCI_Variant xiangqi` and ran correctly in Node).
It is **not used for play**, for three reasons: (1) the build is Emscripten-pthreads and needs
`SharedArrayBuffer`, i.e. cross-origin-isolation headers (COOP/COEP) that static hosts often cannot set,
and it spawns its own nested workers; (2) it is GPL-3.0; (3) the rest of the game must stay verifiable
with my own rules module. Instead the game ships its own search in `src/game/ai.ts`, running in a Web Worker
(`ai.worker.ts`, main-thread fallback if workers are unavailable):

* iterative-deepening alpha-beta (negamax), transposition table (Zobrist keys),
* move ordering: TT move → MVV-LVA captures → killer moves → history heuristic,
* check extensions, late-move reductions, quiescence search on captures,
* hand-tuned xiangqi piece-square tables (soldier crossing, horse/cannon centrality, chariot activity…),
* 困毙 scored as a loss, repetition scored as a draw inside the tree.

Difficulty: **新兵 Recruit** (2 plies, sampled blunders) · **校尉 Captain** (3 plies, mild noise) ·
**將軍 General** (≤5 plies, 1.5 s) · **兵仙 Master** (≤9 plies iterative, 3.2 s). The AI always waits a short
"thinking" delay so it never answers instantly.

## Assets: two tracks (detected at runtime)

* **Track A** — drop `general|advisor|elephant|horse|chariot|cannon|soldier.glb` into `public/models/`.
  They are loaded with `GLTFLoader` (+ `DRACOLoader`), cloned per piece with `SkeletonUtils.clone`; clips whose
  names contain *Idle / Move / Attack* are cross-faded (0.18 s). Red and Black reuse the same GLB — only the
  materials change. Missing files fall back to Track B per piece type.
* **Track B (default)** — fully procedural: bevelled lacquer discs (`LatheGeometry`) with calligraphy
  rendered once per piece type to a cached `CanvasTexture` (1024 px; used as colour map **and** as bump map so
  the characters look carved, plus a gold / silver-bronze inlay ring), and procedural Qin-terracotta warriors
  (layered armour skirt, torso lames, pauldrons, helmets / topknots, ge halberd + shield, jian + cape, staff,
  horse + rider, elephant, two-wheeled chariot, bronze cannon on a carriage).
* "Classic discs" in Settings hides the warriors; the discs stand on their own.

Font note: *Ma Shan Zheng* has no 傌 / 俥, so Red's horse and chariot discs show 馬 / 車 (colour distinguishes
the sides). The move list keeps the traditional 傌 / 俥 via *Noto Serif SC*.

## Controls

Left-drag orbit · right-drag pan · wheel / pinch zoom (clamped) · **WASD + R/F** fly camera (Shift = fast) ·
**H** hides the UI · camera presets 帥位 / 俯瞰 / 側觀 / 戰場 (1.2 s ease-in-out-cubic, orbiting around the
target so it never cuts through the board). Tap / click a piece → jade ring + glowing ink-dot destinations
(red rings for captures). Selecting a horse or elephant flashes a tiny glyph on whatever blocks a leg / eye
(蹩馬腿 / 塞象眼); selecting an elephant makes the river glow as a barrier; tapping an illegal point explains
why (river limit, flying general, leaves general in check). Move list in Chinese notation (炮二平五, 馬8進7),
WXF (C2=5) or ICCS coordinates (h2e2). Everything is bilingual (中文 / English).

## Architecture

```
src/
  main.ts                    boot
  core/   renderer.ts loop.ts tween.ts util.ts constants.ts textures.ts
  scene/  environment.ts lighting.ts board.ts river.ts trays.ts
  pieces/ disc.ts warrior.ts animator.ts pieceView.ts provider.ts (GLB / procedural)
  fx/     particles.ts shatter.ts cannonShell.ts highlights.ts sealStamp.ts
  game/   rules.ts (+ tests) notation.ts state.ts ai.ts ai.worker.ts aiClient.ts choreographer.ts game.ts
  camera/ rig.ts
  audio/  sfx.ts
  ui/     hud.ts i18n.ts settings.ts styles.css
```

* **Single RAF loop** (`core/loop.ts`) with delta time and a global `timeScale` (hit-stop = 0.35 for 0.25 s).
* **Renderer**: DPR ≤ 2, ACES filmic (exposure 1.2) / sRGB, PCFSoft shadows with `autoUpdate = false`
  (the shadow map is refreshed only when something moves, ~7 Hz when idle), PMREM environment generated from a
  small procedural scene (warm panels on Red's side, cool on Black's).
* **Post**: HalfFloat `EffectComposer` → threshold-selective Bloom (gold inlay, fire, embers, shell, seal glow
  are HDR-emissive; nothing else crosses the threshold) → exposure + ACES → Vignette (0.5) → SMAA; film grain on
  Ultra. Low skips the composer entirely.
* **Quality tiers**: Low (no bloom/SMAA, cheap water, 1024 shadows, DPR 1) · High · Ultra (grain, 4096 shadows,
  more embers / mist). An FPS guard drops to Low if average FPS < 45 for 3 s.
* Geometries / materials are shared; character textures are generated once per (piece, side, orientation) and
  cached; fragments (chunks, disc halves, particles) are pooled or disposed.

## What was verified (and how)

* **Rules**: perft(1..4) exact, 32 unit tests, and a 200-position cross-check against Fairy-Stockfish.
* **Notation**: canonical openings (炮二平五, 傌八進七, 馬8進7, 砲8平5, 前俥退一 …) and WXF.
* **AI**: mate-in-one, wins hanging material, never returns an illegal move; Master beats Recruit as either
  colour and General beats Captain in self-play; ≈ 0.4–0.45 M nodes/s in V8.
* **Game flow in a real browser (headless Chromium, software GL)**: click-to-select / click-to-move, AI reply,
  cannon capture over a screen piece, melee capture (strike → hit-stop → shatter), check stamp, checkmate →
  general falls → scroll, replay, undo, side flip, classic mode, Ultra tier, mobile portrait + landscape,
  production build + worker, Track A GLB detection (using a hand-built test GLB), console clean.
* **Not verifiable here**: real-GPU frame rate. CPU-side per-frame work (all animators + effects) measures
  ≈ 0.15 ms; one full frame is ≈ 600 draw calls for the main pass (+ the shadow pass, which only re-renders when
  something moves). Headless software rendering runs at ~1–2 FPS, so the 60 fps / 45 fps-guard targets are by
  design and budget, not by measurement.

## Known limitations

* The perpetual-check / chase rules and the 60-move rule are not implemented (see above).
* The procedural warriors are stylised and chunky rather than museum-grade; Track A lets you swap in real models.
* Software-rendered CI/headless browsers run this at single-digit FPS; a GPU is expected.
