# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, random food,
fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Not implemented yet.

## Secret gate

Every commit is scanned. Enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

It runs `gitleaks protect --staged` (install: `scoop install gitleaks`) and falls back to a
pattern + high-entropy scan when gitleaks is missing. To run it by hand:
`node scripts/precommit-scan.mjs`.
