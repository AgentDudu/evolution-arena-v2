# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, random food,
fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: deterministic simulation core exists (seeded PRNG, spatial hash, fixed-step tick
pipeline, headless runner, 29 tests). No renderer or UI yet.

```sh
pnpm install
pnpm dev                          # browser shell (no canvas yet)
pnpm test                         # 29 tests, ~40 s
pnpm typecheck
node scripts/headless.ts 5000     # seed, ticks -> report + state hash + throughput
```

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (gitleaks 8.30.1 is installed on this machine) and falls back
to a pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
