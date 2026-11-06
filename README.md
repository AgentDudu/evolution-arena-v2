# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, two size classes of
food, fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: items 1-4, 4b and 6 of the plan are in. Deterministic core (seeded PRNG, spatial hash,
fixed-tick pipeline), aerial Canvas 2D renderer with play/pause/step/speed/turbo, selection that
measurably moves the mean genome over 10 sim-minutes, and a size-structured food web that keeps a dwarf
morph (r 4-8) and a giant morph (r ~15) side by side for a **full sim hour** on three seeds, with
nothing in between. Plus a graphs column (population, energy, trait means, species, size histogram)
and a per-organism inspector. Param editors and save/share are not built yet.

```sh
pnpm install
pnpm dev                          # http://localhost:5173 — whole world fitted to the window
pnpm test                         # everything: 79 tests, ~9 min (long arena runs dominate)
pnpm test:quick                   # same suite minus *.long.test.ts: 59 tests, ~4 s — the edit loop
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
s = cycle speed 1x → 2x → 4x → 8x, t = turbo (ticks until the frame budget is spent, still draws).
The HUD prints the live species-class count and the population mean genome; the right column graphs
population, food, total energy, trait means as a share of each gene's range, species count, and the
radius histogram. The inspector follows a **lineage**, not an array slot, so the tracked organism
survives the compaction that happens whenever one dies.

Food comes in two classes: small green particles (radius 3, 25 energy) that any organism can handle,
and large yellow-green ones (radius 8, 60 energy) that only an organism of radius ~14.5 or more can
swallow. That exclusivity is the food web: the giant morph has a resource the dwarf morph cannot
touch, so it recovers when rare instead of being outbred. Particles below an organism handling size
are still eaten, but worth only 15% — a giant can barely live on crumbs, which is deliberate: making
crumbs outright inedible starved the giant morph with a stock of large particles it could not find.

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (gitleaks 8.30.1 is installed on this machine) and falls back
to a pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
