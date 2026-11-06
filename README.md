# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, random food,
fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: items 1-4 of the plan are in. Deterministic core (seeded PRNG, spatial hash, fixed-tick
pipeline), aerial Canvas 2D renderer with play/pause/step/speed/turbo, selection that measurably
moves the mean genome over 10 sim-minutes, and size-structured predation that keeps two radius morphs
(giants ~15.6, dwarfs ~5-7) side by side for more than 5 sim-minutes. No graphs, param editors, or
save/share yet.

```sh
pnpm install
pnpm dev                          # http://localhost:5173 — whole world fitted to the window
pnpm test                         # 58 tests, ~150 s (long arena runs dominate)
pnpm typecheck
node scripts/headless.ts 36000    # [ticks] [seed] [json params] -> report + species + state hash
pnpm build && npx vite preview --port 4321 &
pnpm browser-check                # headless Edge over CDP: ticks/s, turbo, painted-pixel check
```

Controls: click = drop food, shift+click = inspect an organism (shows its sense radius), space =
pause, n = one tick, s = cycle speed 1x → 2x → 4x → 8x, t = turbo (ticks until the frame budget is
spent, still draws). The HUD prints the live species-class count and the population mean genome.

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (gitleaks 8.30.1 is installed on this machine) and falls back
to a pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
