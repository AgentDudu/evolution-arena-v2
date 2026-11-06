# Evolution Arena — Implementation Plan

Status: items 1-4 of §14 are merged on `develop` (deterministic core, visible arena, selection
over 10 sim-minutes, predation + size morphs). Items 5-8 are not started.
Branch: `docs/evolution-arena-plan` (from `develop`).
Date: 2026-11-06.

## 1. What we are building

A live browser arena. It starts with 100 organisms with random heritable traits in a
bounded world where food spawns randomly. Every fixed simulation tick an organism senses,
steers, moves, burns energy, eats, reproduces with mutation, and dies at zero energy. Nobody
scripts who wins — the energy bookkeeping does. The whole arena is visible at once (aerial /
fixed camera, no agar.io follow-zoom), it can be paused, speed-changed, and edited while
running like a sandbox, and a side panel graphs population and trait statistics as time passes.

### Non-goals (v1)

Multiplayer, accounts, server-authoritative sim, 3D, physics engine, GPU/WebGPU compute,
neural-network brains, mobile-first design, sound, and a player-controlled organism. Each is
listed later as a possible extension, not as a work item.

## 2. Decisions (confirmed with owner)

| Area | Decision |
| --- | --- |
| Behaviour | Parametric steering: heritable trait genes + heritable behaviour weights. No neural nets in v1. |
| Ecosystem | Randomly spawned food **plus** agar.io-style size predation (bigger eats smaller on overlap past a size ratio). |
| Rendering | Vite + TypeScript + Canvas 2D, one draw pass, world fits the viewport. Population cap ~2000. |
| Scope | Client-only. No backend, no DB, no third-party keys. Saves in `localStorage`, sharing by seed + params in the URL hash. |
| Camera | Fixed aerial view of the entire arena. Zoom only for inspection, never a follow camera. |

### Defaults I picked — veto any of these

1. **Bounded arena with wall bounce** (not a torus). Torus becomes a config flag later.
2. **One food type** in v1 (plus "food cluster" painting in the sandbox). Producers/plot
   regrowth is an extension.
3. **Asexual fission** reproduction (parent splits energy with the child) — no mating pairs.
   Mating/sexual recombination is an extension.
4. **Species** = greedy centroid clustering over normalised genome distance, threshold-based.
   Gives a "species count" line on the graphs without a real phylogenetic engine.
5. **Hue is a neutral marker gene** (no fitness cost) so lineage spread is visible by colour.
6. Charts via **uPlot** (~47 KB, streams cheaply: ~10% CPU on a live sine stream vs ~60% for
   Chart.js in uPlot's own bench). Everything else is hand-rolled.
7. Sim and render are separated; the sim can run headless in Node for tests and benchmarks.

## 3. Stack

- Vite 7 + TypeScript 5 (strict, `noUncheckedIndexedAccess`) — ESM only.
- No framework. DOM for panels/controls, one `<canvas>` for the arena.
- `uPlot` for time-series; hand-drawn histogram bars in the same canvas or a tiny second canvas.
- `vitest` for unit/determinism/benchmark tests.
- ESLint + Prettier, `simple-git-hooks`-free: plain git hook script in `scripts/`.
- Node >= 24 (installed: v24.14.1, npm 11.11, pnpm 11.24, git 2.54, gh 2.102).

## 4. Architecture

```text
src/
  core/
    rng.ts          seeded sfc32 + seed string -> uint32; one stream for all randomness
    config.ts       SimParams (all tunables, validated), defaults, param schema for UI
    space.ts        world size, wrap/bounce, distance helpers
    grid.ts         uniform spatial hash grid (food grid + organism grid), rebuilt per tick
    types.ts        Genome, OrganismView, FoodView, TickReport
  sim/
    world.ts        authoritative state (SoA typed arrays) + the tick pipeline
    organisms.ts    spawn, mutate, split, kill, swap-remove
    food.ts         spawn rate, caps, cluster injection
    think.ts        sense -> steering -> actuator output
    energy.ts       maintenance, move cost, eating, clamps
    predation.ts    size-ratio eats, energy transfer
    lineage.ts      lineage ids, species centroids, generation counters
    metrics.ts      per-sample aggregates into ring buffers
  render/
    canvas2d.ts     one draw pass, colour-bucket batching, DPR aware
    palette.ts      genome/species -> colour
    overlay.ts      grid lines, selection, inspector callout
  ui/
    app.ts          wiring, rAF loop, accumulator
    controls.ts     play/pause/step/speed/seed/reset
    sandbox.ts      god-mode tools (spawn, paint food, delete, events)
    inspector.ts    selected organism panel
    charts.ts       uPlot instances + downsampling
    save.ts         localStorage slots + URL hash share
test/               vitest specs, one per module + sim integration + bench
```

### Data layout

Struct-of-arrays in typed arrays, so a 2000-organism tick is a tight numeric loop:
`x, y, vx, vy, energy, radius, senseRadius, maxSpeed, metabolism, reproThreshold, hue,
seekFood, flee, wander, age, gen, lineageId, speciesId` as `Float64Array`/`Int32Array`,
plus `alive` count with swap-remove compaction. Fixed capacity arrays
(`MAX_ORGANISMS = 2000`, `MAX_FOOD = 1500`), no per-tick allocation.

### Determinism (this is what makes saves tiny and graphs trustworthy)

- Fixed `dt = 1/60` sim-second; render frame uses an accumulator and runs 0..N ticks.
  Speed multiplier = more ticks per frame, never a bigger `dt`.
- **One** PRNG stream (seeded `sfc32`) drives food spawn, wander noise, mutation, and event
  timing. No `Math.random`, no `Date.now`, no iteration over object keys inside the sim.
- Fixed iteration order (index order, stable swap-remove).
- `stateHash()` = FNV-1a over the canonical numeric state. Same seed + same params + same
  tick count must give the same hash. That test is the regression net for every rule change.

### Tick pipeline (fixed order, every tick)

1. World events: food spawn, active sandbox events (drought, meteor, cold snap).
2. Rebuild spatial grids (food grid, organism grid).
3. Sense + think: read tick-start state, write into `next` buffers (double-buffered, so
   neighbour reads are consistent — same trick as pelagia's CPU oracle).
4. Integrate motion, wall bounce, friction.
5. Eat food (grid query within `radius + foodRadius`).
6. Resolve predation (grid query, size ratio, energy transfer, victim queued dead).
7. Metabolism + move cost, then death collection at `energy <= 0`.
8. Reproduction: queued fissions appended if capacity allows, genes mutate on copy.
9. Metrics + lineage/species bookkeeping every `METRIC_EVERY = 15` ticks.

## 5. Simulation rules

All numbers below are starting values to tune in the live param panel, not settled science.

### Genome

| Gene | Range | Fitness role |
| --- | --- | --- |
| `radius` | 4–16 u | mass = radius²; bigger = wins predation, slower, costlier |
| `maxSpeed` | 25–120 u/s | catch prey, escape; effective speed penalised by radius |
| `senseRadius` | 20–200 u | finds food/threats earlier; cost ∝ senseRadius² (neural tissue) |
| `metabolism` | 0.6–1.6 | multiplier on maintenance — slow-burn vs high-pace |
| `reproThreshold` | 120–400 energy | breed early and small, or store up and breed big |
| `seekFood` / `flee` / `wander` | 0–1 each | steering weights; flee only fires against larger organisms |
| `hue` | 0–360 | neutral marker: visual lineage trace, no cost |

Effective speed: `speed_eff = maxSpeed / (1 + SPEED_PENALTY * (radius - 4))`, `SPEED_PENALTY` ≈ 0.04.

### Energy budget

```text
maintenance/tick = dt * metabolism * (BASE_META + META_K * mass^META_EXP)   # mass = r^2, exp 0.75
move cost/tick   = dt * MOVE_K * speed^2 * mass^0.5
food gain        = +25 energy per particle
eat organism     = +0.5 * victim.energy, victim dies
reproduction     = allowed at energy >= reproThreshold and age >= MIN_AGE;
                   parent pays reproShareParent * threshold, child starts at that cost
                   * reproShareChild
death            = energy <= 0, or eaten, or age > MAX_AGE (default off)
```

The trade-off that makes selection real: food supply is finite, every trait costs energy, so
nothing can max every gene. Sensing is expensive, speed is expensive, size is expensive.

### Predation (agar.io rule, size-structured)

On overlap, `A` eats `B` when `radiusA / radiusB >= PREDATION_RATIO` (default 1.25) **and**
`B.radius >= PREY_MIN_RADIUS` (default **9**) **and** `A.radius >= PREDATOR_MIN_RADIUS` (default 6).
The predator floor keeps juveniles from hunting; the prey floor is a gape/handling limit and is the
size refugium a dwarf morph survives in. Size-structured predation plus allometric metabolism is
the mechanism that produces food webs in Loeuille & Loreau 2005 (PNAS, doi:10.1073/pnas.0408424102).

Measured, not assumed: with only the predator floor, size selection ran away to the top of the
range (mean radius 15.25 of a 4-16 range, every surviving class a giant). Adding the gape floor
and raising it to 9 gave the two-morph outcome §14 item 4 asks for. One kill per hunter per tick.
Prey is chased with the existing `seekFood` weight (an edible organism is simply nearer food), so
the §5 gene list did not change.

### Mutation

Per gene on fission: with probability `MUT_RATE` (0.15) add Gaussian noise `sigma = 5%` of the
gene range, then clamp to range. Seed makes the whole offspring genome reproducible.

### Guardrails against accidental extinction

Extinction is a legitimate outcome, but a sim that dies of a bad first second is a bug. So:
`foodFloor` (minimum food particles regardless of rate, default 60), optional `reseedOnEmpty`
toggle (default on, spawns 20 random organisms from the seed), population cap, and a
`tick 0..N` deterministic warmup so the first frame is never empty.

## 6. Rendering (aerial, no follow zoom)

- One `<canvas>`, sized to the viewport with device-pixel-ratio scaling; the world
  (default 1600 x 900 units) is fitted to the canvas with `scale = min(cw/worldW, ch/worldH)`.
  A single uniform scale = the whole arena on screen, which is the whole point.
- Draw order: arena background + grid ring, food, organisms, overlays.
- Food: fill circles batched per colour bucket (`beginPath` once per bucket, not per particle).
  Organisms: fill circle for body, thin ring for the sense radius only on the selected one.
- Colour: hue from the neutral hue gene; ring colour from species id. Size reads the radius gene,
  so trait drift is visible without opening a graph.
- Camera: fixed aerial only. No player avatar, no controllable organism (owner decision).
  Scroll-zoom is a magnifier for inspection; there is no follow camera and no input-driven
  movement, so the sim has exactly one actor type.
- Render is decoupled from ticks: `rAF` draws interpolated positions (`x`,`y` vs `prevX`,`prevY`)
  so 1x speed looks smooth even when ticks land at 60 Hz.

## 7. Sandbox / god-mode

Every tool injects through the same deterministic PRNG stream and is recorded as a command, so a
world + its edit log replays exactly.

- Pause / step one tick / speed 1x, 2x, 4x, 8x, and a "turbo (no render)" mode for fast-forwarding evolution.
- Reset with a new seed, or restart the current world from tick 0 keeping the edit log.
- Paint food (click-drag), place a food cluster of N, remove food.
- Spawn organism(s) from a trait editor: sliders per gene, live preview circle, "place", or
  "place 10 identical" to seed an engineered lineage against the wild population.
- Delete organism (click). Click any organism to inspect it live.
- Live param sliders: food rate, food cap, predation ratio, mutation rate, maintenance constants,
  world size — applied without a restart (the sim reads `SimParams` each tick).
- Events: meteor (kills in a radius, drops food), cold snap (metabolism multiplier for N ticks),
  drought (food rate to 0 for N ticks), plague (energy hit to all organisms). Each is a timed
  modifier object on the world, not a separate system.
- Obstacles/walls and fertile zones: deferred — they change the grid and the movement code and
  are not needed to see natural selection.

## 8. Live graphs

Sampled every 15 ticks (4 samples/sim-second) into ring buffers, downsampled when a window is
full so memory stays flat.

- Population over time (organisms, food count, food/organism ratio).
- Energy flux: total energy in the organism pool, food supply, and a births/deaths rate line.
- Trait means over time: one multi-series line chart with a per-gene toggle
  (radius, maxSpeed, senseRadius, metabolism, reproThreshold).
- Trait distribution: histogram of the currently selected gene, current window, so a bimodal
  radius distribution (small refuge morph vs large predator morph) is visible directly.
- Species count + top species share over time; species legend with colour swatches.
- Generation: mean lineage depth, and max.
- Selected organism inspector: energy bar, genome table, age, species, its own 60s sparkline,
  plus "isolate" (hide all other species) and "follow its descendants" highlight.
- Export: CSV of the metric series and JSON snapshot of the world + params + edit log.

## 9. Persistence, sharing, privacy

- `localStorage` under `ea:autosave:v1` (every ~5 s) plus named slots `ea:slot:<name>`.
  Contents: seed, params, edit log, tick count, metric series. Not the raw world — the world is
  recomputed by replaying ticks, which keeps a save a few KB instead of MB.
- Share link: `#s=<seed>&p=<base64 params>&log=<base64 commands>`. Opening it replays to the
  sender's tick count. Replay is only trusted for a matching `configVersion`; mismatch shows a
  "replaying at tick 0" notice instead of silently diverging.
- No network calls at all. No analytics, no CDN, no fonts. Everything ships from the bundle.
- Privacy: no personal data of any kind enters the app or the repo. The only identity present is
  the git author email in commit metadata, which comes from the local git config.

## 10. Performance budget

| Budget | Target |
| --- | --- |
| Tick cost @ 2000 organisms + 1500 food | < 4 ms/tick (so 15+ ticks per 60 fps frame) |
| Render cost | < 6 ms/frame at 2000 circles |
| Headless throughput | > 300k ticks/min for turbo fast-forward |
| JS heap | flat, < 200 MB after 1 sim-hour; ring-buffered metrics only |
| Bundle | < 200 KB gzipped including uPlot |

Enforced by: grid queries instead of O(n²) pair scans, fixed-capacity typed arrays, zero
per-tick allocation, colour-bucket batching, `stateHash` only on demand, and a vitest benchmark
that logs the numbers (soft assertion, so a slow CI box does not fail a rule change).

If the budget breaks, in order: raise the population cap down first (cap 1200), then move the sim
into a Web Worker with a transferred state buffer (kept as an extension, not a phase — it forces
all sim input through messages and complicates the sandbox tools).

### Measured baseline (working core, Node 24, this machine)

| Measurement | Value |
| --- | --- |
| Tick cost @ ~1150 organisms + ~125 food | 1.75 ms/tick |
| Headless throughput | ~570 ticks/s (~34k ticks/min) |
| 5000-tick run, seed `arena-1` | pop 1051, food 140, mean gen 4.14, `stateHash 7b576f95` |
| 5000-tick run, seed `arena-2` | pop 1156, food 156, mean gen 4.37, `stateHash c9da68e3` |
| Trait drift over 5000 ticks (`arena-1`) | radius 8 → 12.05, senseRadius 80 → 50.5, metabolism 1.00 → 0.85, maxSpeed 60 → 94.7 |
| Browser, Edge headless 1280x720, speed 1x | 60 fps, 60 ticks/s, 0.8–0.9 ms/tick, canvas ink 8.7% of pixels |
| Browser, turbo (time-boxed 12 ms/frame) | ~400 ticks/s at 49 fps — UI keeps drawing; throughput now scales with ms/tick, so the perf pass raises it directly |
| Browser long run (tick 5521) | pop 1226, food 165, mean gen 4.11 — same regime as headless |
| Headless 36000 ticks (10 sim-min), `reseedOnEmpty: false` | `arena-1` pop 1559, gen 13.1; `long-2` pop 1777, gen 8.8; `long-3` pop 1450, gen 13.1 — nobody went extinct |
| Mean genome drift, `arena-1` tick 500 → 36000 | radius 10.6 → 14.1, sense 91 → 34, metabolism 1.04 → 0.63, seek 0.61 → 0.76, flee 0.53 → 0.36 |
| Food at 10 sim-min | 36–76 particles: the arena is food-limited, which is what drives the drift above |
| Tick cost with predation on | 2.1–2.8 ms/tick at pop 1400–1800 (1.3–1.9 without); bench @1148 organisms 1.63 ms |
| Headless 36000 ticks with predation | `arena-1` pop 1494, 6 size classes r5.3–r15.6 (giants 940+425, dwarfs 85+19); `morph-1` pop 1425, 6 classes; `long-2` pop 1777, 7 classes, mean radius 7.9 — a different food web per seed |
| Browser turbo with predation | ~208 ticks/s at 49 fps (was ~400): one extra grid query per hunter per tick is the whole gap |
| Bundle | 6.45 kB gzipped (budget 200 kB) |

So the real budget is **not met yet**: 34k ticks/min against a 300k target. One tick at 60 Hz is
comfortable (1.75 ms of a 16.7 ms frame), but turbo fast-forward at 8× is not. Before any
architecture change, the cheap candidates are: the threat query in `think()` scans up to
`senseRadius` on the organism grid (drop the flee scan when `flee == 0`, which most organisms
have after a few hundred ticks), the food grid's stale cells after a swap-remove, and reusing one
scratch buffer for grid buckets. Re-measure after each.

## 11. Testing

Actual files in `test/` (29 tests, ~41 s on this machine, `pnpm test`):

- `rng.test.ts` — golden stream hash for `arena-1` (0x27f39617), same-seed replay, uniformity,
  and a **seed-correlation gate**: `arena-1` vs `arena-2` must stay under |r| = 0.05. That gate is
  what caught the weak initial seeding; sfc32 state is now filled with splitmix32.
- `grid.test.ts` — `nearest()` matches a brute-force scan at cell sizes 16/64/200, `accepts`
  filter, `visit()` coverage, `clear()`.
- `world.long.test.ts` — determinism at 5000 ticks, same hash for the same seed and params, different
  hash for a different seed or one changed param, `reset()` reproduces tick 0, hash moves every
  tick.
- `invariants.test.ts` — no `Math.random(`/`Date.now(` in `src/core` or `src/sim` (grep test),
  param validation rejects nonsense, mutations always land in the declared gene range, mutation
  rate 0 is a true no-op, per-tick bounds on population/food/energy/positions/genes, generation
  gap (no child acts in its birth tick), reseed-on-empty both ways.
- `behaviour.long.test.ts` — evolution is not noise: 6000 ticks keep a living population, reach mean
  generation ≥ 3, move at least three trait means more than 3% off their founding values, and end
  at different trait distributions for different seeds.
- `bench.long.test.ts` — soft throughput guard (< 8 ms/tick at ~1000 organisms) that logs the numbers.
- `camera.test.ts` — one uniform scale, letterboxing not stretching, tall/wide viewports, css↔device
  pixel round trip through world coordinates.
- `loop.test.ts` — fixed-step accounting: 60 ticks per elapsed second at dt 1/60 (this caught a
  float loop that lost one tick every second), remainder carry, speed multiplies ticks without
  touching `dt`, catch-up cap, negative input ignored; plus palette bucket/key bounds.
- `evolution.long.test.ts` — the work item 3 proof: `arena-1` runs 36000 ticks (10 sim-minutes) with
  `reseedOnEmpty: false`, population never touches zero and stays > 50, and at least three gene
  means move by more than 8% of their range. Deliberately direction-free: which traits win is a
  property of the seed and food field, so hard-coding directions would make the test a tautology.
  Two more seeds are checked at 10000 ticks. Slowest file in the suite (~105 s).
- Long arena runs in tests are chunked (`1000` ticks then `setImmediate`) because the vitest
  worker→host progress channel has a fixed 60 s timeout with no config knob (vitest#11082, #8164):
  one synchronous 60 s+ loop makes the whole run exit 1 with `Timeout calling "onTaskUpdate"`
  even though every test passed.
- Slow files are named `*.long.test.ts`. `pnpm test` runs everything (~150 s, the proof);
  `pnpm test:quick` excludes that glob (46 tests, ~4 s) and is the edit loop. The quick lane keeps
  a 500-tick determinism check (`determinism.test.ts`) so the core invariant is never skipped.
- `scripts/browser-check.ts` (`pnpm browser-check`, needs `vite preview`) — drives headless Edge over
  CDP: asserts no page exception, reports real-time ticks/s, turbo ticks/s, population/food/generation,
  canvas pixel size, and the fraction of canvas pixels that differ from the background (proof the
  frame is actually painted).
- `predation.test.ts` — the rule on a two-organism arena with food, movement and reproduction off:
  ratio boundary, both size floors, overlap required, one kill per hunter, energy cap, predation
  off. `predation.long.test.ts` — the item 4 proof: two radius morphs >= 4 units apart sustained
  for over 5 sim-minutes.
- `mutation.test.ts` — genes stay in range, same seed gives the same child genome, unrelated seed
  gives a different one.
- `metrics.test.ts` — ring-buffer downsampling keeps first/last and monotonic time.
- `save.test.ts` — replay from seed + edit log reproduces the same `stateHash`.
- `bench.test.ts` — throughput numbers printed.
- Manual QA checklist in the docs: pause/step/speed, all sandbox tools, all charts, resize +
  DPR change, save/reload, share-link round trip.

## 12. Secrets and sensitive data

The chosen scope needs **no** secrets: no backend, no DB, no API keys, no tokens. The plan keeps
it that way and still puts a gate in place so nothing can leak later.

- `.gitignore` already ignores `.env`, `.env.*` (with `!.env.example`), `dist/`, `node_modules/`,
  `*.local`.
- `.env.example` ships with comments only, no values: `# No secrets required. If a backend is
  added later, put DATABASE_URL / SESSION_SECRET here and never commit the real .env.`
- Never paste tokens, cookies, private URLs, or personal data into source, docs, or commit
  messages. No credentials in `README`/`PLAN`.
- Pre-commit scan, run before **every** commit (documented, and wired as a hook in
  `scripts/precommit-scan.mjs`):
  1. `git status --short` — confirm nothing unexpected is staged (no `.env`, no browser profile,
     no downloads, no `.pem`/`.key`, no `*.local`).
  2. `git diff --cached | gitleaks protect --staged --no-banner` when `gitleaks` is on PATH
     (gitleaks 8.30.1 is installed here); otherwise the script falls back to a high-entropy + pattern grep
     for `AKIA[0-9A-Z]{16}`, `gh[pousr]_[A-Za-z0-9]{20,}`, `-----BEGIN .*PRIVATE KEY`,
     `(password|secret|token|api[_-]?key)\s*[:=]`, and long base64 runs.
  3. Confirm `git config user.email` is the intended public author email.
- GitHub side (extension, not a phase): a `gitleaks` action on PRs, and the repo stays public-safe
  without it.

## 13. Git workflow

Gitflow, remote `github.com/AgentDudu/evolution-arena-v2`.

- `main` = released states only. **Never pushed, merged, or PR'd into `main` without explicit
  owner approval.** `main` does not exist on the remote yet; the first promotion needs a green
  light from the owner.
- `develop` = integration branch. Feature branches merge here freely.
- Branch naming: `feature/<scope>-<summary>`, `fix/<summary>`, `docs/<summary>`,
  `chore/<summary>`, `perf/<summary>`. One branch per work item, short-lived, merged by PR to
  `develop` (or a direct merge when the item is one commit).
- Commit messages: Conventional Commits — `feat(sim): ...`, `fix(render): ...`,
  `test(world): ...`, `chore(deps): ...`, `perf(grid): ...`, `docs: ...`. Scope = the area touched.
  **No "phase"/"stage"/"milestone" wording in any commit message, branch name, or PR title** —
  the phase list below is internal planning only.
- PRs into `develop` are allowed and encouraged for anything larger than one commit; PRs into
  `main` are the only approval-gated thing.

## 14. Work items

Each item is independently mergeable to `develop` and leaves the app running.

| # | Work item | Deliverable | Done when | Size |
| --- | --- | --- | --- | --- |
| 1 | Deterministic core | `rng`, `config`, `space`, `grid`, SoA world, tick pipeline skeleton, headless runner | same seed → same `stateHash` at tick 5000; grid matches brute force | M |
| 2 | Visible arena | Canvas 2D aerial renderer, DPR/resize, fitted world, food + movement + energy + death, play/pause/step/speed | 100 organisms visible, whole world on screen, 60 fps, organisms starve and die | M |
| 3 | Genome + selection | Full gene set, allometric costs, fission with mutation, hue marker, lineage ids, generations | population survives > 10 sim-minutes and gene means visibly drift (test asserts drift, not direction) | M |
| 4 | Predation & food web | size-ratio eats, juvenile + gape size floors, energy transfer, species as size classes | two size morphs coexist for > 5 sim-minutes; species count line is non-trivial | M |
| 5 | Sandbox tools | paint food, spawn from trait editor, delete, live params, events, seed/reset | an engineered lineage placed mid-run visibly competes with the wild population | L |
| 6 | Graphs & inspector | uPlot panels (population, energy, trait means, species), histogram, per-organism inspector + isolate/follow | all panels update live and survive a 1-hour turbo run without heap growth | M |
| 7 | Save & share | autosave, named slots, seed+params+log replay, share link, CSV/JSON export | a share link reproduces the sender's `stateHash` at its tick count | M |
| 8 | Hardening & polish | perf pass vs budgets, keyboard shortcuts, mobile/touch basics, README how-to-run, error boundary, `precommit-scan` hook | budgets in §10 met on a mid-range laptop; fresh clone runs with `pnpm i && pnpm dev` | M |

Done so far: items 1-4 are merged. Item 4 evidence — `test/predation.test.ts` holds the rule
(overlap + ratio + both size floors + one kill per hunter + energy cap) and shows two radius
morphs separated by >= 4 units coexisting for over 5 sim-minutes; the HUD prints the class count.

Order is dependency order, not a promise about commit content. Items 1-4 make evolution happen;
5-7 make it a sandbox you can manipulate and share; 8 makes it pleasant and fast.

### Later extensions (no commitment)

Web Worker sim, PixiJS renderer behind a `Renderer` interface, sexual reproduction + recombination,
neural-network genomes, obstacles and fertile zones, producers/plants, phylogenetic tree view,
scenario files (saved worlds as content), multiplayer/server-authoritative mode, an offline
`node` batch mode for headless experiments, WebGL food rendering, achievements/goals.

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| Population crashes to zero in the first minute and the demo is boring | food floor, juvenile refuge, reseed toggle, drift tests that assert survival windows |
| Runaway population exhausts the food grid and the frame rate dies | hard organism cap, capped food supply, density-dependent food spawn, budget test |
| "Evolution" is just noise: genes drift with no selection signal | every gene must carry an energy cost (sensing, speed, size) so maxima are not free; watch trait-mean lines vs fitness proxies |
| Fitness traps / degenerate strategies that game the metric (see Lehman et al. 2020, *Artificial Life* 26(2), doi:10.1162/artl_a_00319) | measure several metrics at once, no single-number "fitness" readout, keep energy accounting inspectable |
| Non-determinism sneaks in and breaks saves/sharing | single PRNG stream, grep-for-`Math.random` test, `stateHash` tests at several tick depths |
| Canvas 2D stops keeping up past ~2000 entities | §10 order of operations, then the `Renderer` interface + Pixi path |
| Tuning rabbit hole with no visible emergent behaviour | start from published mechanism (size-structured predation + allometric metabolism, Loeuille & Loreau 2005) instead of inventing rules |

## 16. Prior art and sources

Papers (model justification):
- Loeuille, N. & Loreau, M. 2005. *Evolutionary emergence of size-structured food webs.* PNAS
  102(16):5761-5766. doi:10.1073/pnas.0408424102 — body size adaptation + metabolism alone
  generate food-web structure. The basis for §5 predation + cost scaling.
- *Interspecific Allometries Are by-Products of Body Size Optimization.* The American Naturalist
  149(2):352-380 (1997). doi:10.1086/285994 — maintenance cost scaling with body size; OpenAlex
  index lists the authors as Jan Koziowski and January Weiner.
- DeLong, J.P. 2012. *Experimental demonstration of a 'rate-size' trade-off governing body size
  optimization.* Evolutionary Ecology Research 14(3):343-352 — growth/reproduction trade-off.
- Lehman, J., Clune, J. et al. 2020. *The Surprising Creativity of Digital Evolution.* Artificial
  Life 26(2):274-306. doi:10.1162/artl_a_00319 — fitness traps and cheating in digital evolution.
- Ortega, R. et al. 2023. *Ontology for the Avida digital evolution platform.* Scientific Data
  10:608. doi:10.1038/s41597-023-02514-3 — vocabulary for describing digital-evolution experiments.

Working software reviewed for architecture (ideas only, no code copied):
- `bastian9819/pelagia` — browser artificial life, thousands of neural creatures, WebGPU compute +
  **TypeScript CPU reference implementation as the correctness oracle**, spatial grid, seeded RNG,
  share-by-URL, Vitest. Note: it is AGPL-3.0, so no source may be copied into this repository;
  only the architecture patterns (double-buffered think step, grid rebuild order, oracle tests)
  were reviewed. Our scope — parametric steering on Canvas 2D — shares no implementation with it.
- `simongonzalezdc/EvoLab` (MIT) — React + PixiJS + D3 + Matter.js + Dexie evolution simulator with
  `genetics/`, `ai/`, `environment/`, `rendering/` split and a population graph; useful as a scope
  warning: it grew to dozens of subsystems and hundreds of dev docs. Ours stays smaller on purpose.
- `nicohartmann.dev/en/projects/evosim` — 3-gene canvas evolution sim (speed, vision range, size)
  with colour reflecting genes.
- `abc.tools/sim/evolution` — genes for max speed, body size, sense radius, colour, metabolism,
  reproduction threshold; the closest match to the §5 gene set.
- `mark-auman.itch.io/minimals`, `cylian.org/artificial-intelligence/creatures` — trait-editor
  sandbox framing (predation by size ratio, aging, obstacles, fertile zones).
- Benchmarks: uPlot sine-stream vs Chart.js/ECharts (uPlot's own bench, ~10% vs ~60% CPU),
  `renderer-benchmark` / Pixi bunnymark for canvas-vs-WebGL entity counts.

Resolved: no player-controlled organism (owner decision, 2026-11-06). The arena is watched and
edited, never inhabited — see §2 and §6.
