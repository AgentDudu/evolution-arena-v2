# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, two size classes of
food, fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: items 1-4, 4b and 6 of the plan are in. Deterministic core (seeded PRNG, spatial hash,
fixed-tick pipeline), aerial Canvas 2D renderer with play/pause/step/speed/turbo, selection that
measurably moves the mean genome over 10 sim-minutes, and a size-structured food web that keeps a dwarf
morph (r 4-8) and a giant morph (r ~15) side by side for a **full sim hour** on three seeds, with
nothing in between. Plus a graphs column (population, energy, trait means, species, size histogram),
a per-organism inspector, and a sandbox release tool: ten gene sliders, a "copy wild mean" button,
arm + click to drop a designed genome into the running world. Delete, live param editors, events and
save/share are not built yet.

```sh
pnpm install
pnpm dev                          # http://localhost:5173 — whole world fitted to the window
pnpm test                         # everything: 88 tests, ~4 min (long arena runs dominate)
pnpm test:quick                   # same suite minus *.long.test.ts: 65 tests, ~5 s — the edit loop
pnpm typecheck
node scripts/headless.ts 36000    # [ticks] [seed] [json params] -> report + species + state hash
node --expose-gc scripts/headless.ts 216000 arena-1   # a sim-hour soak: buffers + collected heap
node scripts/foodweb.ts 216000 arena-1  # size structure every sim-minute: radius percentiles,
                                  # morph counts, large-particle reservoir. [ticks] [seed] [json params]
pnpm build && npx vite preview --port 4321 &
pnpm browser-check http://localhost:4321/?seed=check 4 240   # headless Edge over CDP: ticks/s, painted
                                  # pixels, 4 graph panels, then 240 s turbo soak with heap per 10 s
```

Controls: click = drop food, shift+click = inspect an organism (genome readout + sense radius),
i = isolate its lineage (everything else dims, its trail is drawn), space = pause, n = one tick,
s = cycle speed 1x → 2x → 4x → 8x, t = turbo (ticks until the frame budget is spent, still draws),
e = arm a release: the next arena click drops 1-50 copies of the edited genome there instead of food,
and one release per arming so a runaway click cannot bury the wild population. A released organism
and every descendant of it carry `origin 1`, so they are ringed in yellow in the aerial view, printed
in the HUD (which also prints the species-class count and the population mean genome) and drawn as
the yellow line of the population panel. The right column graphs
population, food, total energy, trait means as a share of each gene's range, species count, and the
radius histogram. The inspector follows a **lineage**, not an array slot, so the tracked organism
survives the compaction that happens whenever one dies.

Food comes in two classes: small green particles (radius 3, 25 energy) that any organism can handle,
and large yellow-green ones (radius 8, 60 energy) that only an organism of radius ~14.5 or more can
swallow. That exclusivity is the food web: the giant morph has a resource the dwarf morph cannot
touch, so it recovers when rare instead of being outbred. Particles below an organism handling size
are still eaten, but worth only 15% — a giant can barely live on crumbs, which is deliberate: making
crumbs outright inedible starved the giant morph with a stock of large particles it could not find.

A released creature has to be designed against the world it lands in, which is the interesting half
of the sandbox. Upkeep carries an `0.0008 * sense^2` term, so a genome with `senseRadius 150` pays 18
energy per tick where the population settled on ~1.7 (sense 46-55): measured, all 12 founders of such
a design were dead inside 100 ticks, and the same happens to a release that starts from the raw gene
defaults (senseRadius 80 = 5 energy per tick). That is why the panel has **copy wild mean** — the
experiment worth running is one gene changed on the genome the population already runs on. Measured
with `test/sandbox.long.test.ts`: wild-mean genome with only radius set to 15.5 on seed `release-mid`
went 12 founders -> 4 alive at +1200 ticks -> peak 19 at +3600 -> 6 at +12000, 8 generations, mean
radius held 15.38-15.57; a radius-5 design on `arena-1` was steadier at 12-17 descendants, 3
generations, radius 4.99-5.07. The wild population was not displaced in either case (1001-1353).

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (gitleaks 8.30.1 is installed on this machine) and falls back
to a pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
