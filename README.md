# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, random food,
fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: the arena is visible. Deterministic simulation core (seeded PRNG, spatial hash, fixed-step
tick pipeline) plus an aerial Canvas 2D renderer with play/pause/step/speed/turbo and a live HUD.
No graphs or sandbox editors yet.

```sh
pnpm install
pnpm dev                          # http://localhost:5173 — whole world fitted to the window
pnpm test                         # 42 tests, ~40 s
pnpm typecheck
node scripts/headless.ts 5000     # seed, ticks -> report + state hash + throughput
pnpm build && npx vite preview --port 4321 &
pnpm browser-check                # headless Edge over CDP: ticks/s, turbo, painted-pixel check
```

Controls: click = drop food, shift+click = inspect an organism (shows its sense radius), space =
pause, n = one tick, 1/2/4/8 = speed, t = turbo (no rendering).

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (gitleaks 8.30.1 is installed on this machine) and falls back
to a pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
