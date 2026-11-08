# evolution-arena-v2

Live 2D evolution arena: a world of organisms with heritable traits, two size classes of
food, fixed-step ticks, energy budgets, size-based predation, and live graphs. Aerial view of
the whole arena - no follow camera.

Planning: [docs/PLAN.md](docs/PLAN.md)

Status: items 1-7 of the plan are in. Deterministic core (seeded PRNG, spatial hash, fixed-tick
pipeline), aerial Canvas 2D renderer with play/pause/step/speed/turbo, selection that
measurably moves the mean genome over 10 sim-minutes, and a size-structured food web that keeps a dwarf
morph (r 4-8) and a giant morph (r ~15) side by side for a **full sim hour** on three seeds, with
nothing in between. Plus a graphs column (population, energy, trait means, species, size histogram),
a per-organism inspector, and the sandbox: ten gene sliders, a "copy wild mean" button, arm + click to
drop a designed genome into the running world, a delete mode, six sim sliders and two checkboxes that
apply to the running world, and three events (food bloom, catastrophe, mutation burst). Save and share:
`save` snapshots the world, `share` builds a link that rebuilds the identical world in another browser,
and reopening the page picks up the last run. The performance pass (item 8) is what is left.

```sh
pnpm install
pnpm dev                          # http://localhost:5173 — whole world fitted to the window
pnpm test                         # everything: 127 tests, ~4 min (long arena runs dominate)
pnpm test:quick                   # same suite minus *.long.test.ts: 104 tests, ~15 s — the edit loop
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

That column is one scroll list of cards — charts, sandbox, sim knobs, run — with the inspector **pinned**
at its bottom, so the genome readout is reachable without scrolling past the run buttons, and the
`charts` / `sandbox` / `run` links in its header jump straight to a card. The `light` button switches the
panel chrome dark ↔ light and remembers the choice; the arena and the plot surfaces stay dark in either
theme because the sim's colour language (yellow = engineered lineage) is calibrated against a dark
field. Under 900 px wide the column becomes a sheet below the arena instead of disappearing, which is
what it used to do on a phone.

The rest of the sandbox panel is the god-mode half. `x` (or the button) switches on **delete mode**, a
sticky mode because clearing a bad lineage means several clicks: each arena click then removes the
organism whose body is under the pointer, with only 6 world units of slack since deleting the wrong one
is worse than missing one. Three event buttons perturb the world — **food bloom** scatters particles up
to `foodCap`, **catastrophe** kills one rng coin flip per organism where they stand, **mutation burst**
runs the ordinary fission mutation step over every genome once, which is how you push a genome without
waiting for generations. Six sliders and two checkboxes (food per tick, large-food share, crumb penalty,
predation ratio, refuge radius, mutation rate, predation on/off, reseed when empty) apply to the
**running** world, so you can watch a rule change take effect instead of restarting. Keys that size the
arena's buffers (`worldWidth/Height`, `maxOrganisms`, `foodCap`) or fix the run's identity (`seed`, `dt`,
`wallMode`) are refused rather than silently half-applied, and everything else goes through the same
`validateParams` gate the world is built with. Every tool and event appends itself to `world.events`, so
the run stays reproducible from (seed, params, ticks, events) — that list is what the share link replays.
The determinism is measured, not asserted: two identically seeded worlds that both hit
`catastrophe(0.5)` at tick 600 ended with the same kill count and the same `stateHash`.

**Save, share, replay.** Two formats, because they answer different questions. A `save` (named slots) and
the autosave that fires every five seconds store the **world itself**: organism and food arrays as base64
typed arrays plus params, event log and counters, prefixed `EA2:`, into `arena.slots.v1` / `arena.autosave.v1`.
Opening one costs one parse, not one tick per tick — measured: tick 3 622 (pop 1 278, 238 KB) back on screen
in 0.54 s, where the replay path needed 28 s for a run of the same size. A snapshot also carries the four
words of the sim's PRNG and the food pacing accumulator, so the run *continues* identically rather than merely
looking right at the saved tick — `test/snapshot.test.ts` steps both worlds 300 further ticks and requires the
hashes to still agree. It is refused unless the world it rebuilds hashes to what was written, so a truncated or
edited save says so instead of loading a subtly different run. They live in localStorage only: 240–300 KB for a
full arena, so the ~5 MB quota is roughly ten named slots, and a write the browser refuses is said once and then
stopped rather than retried every 5 s. `share` (or `s`) builds a link like `…/?run=1H4sIA…`: gzip + base64url, 875 characters for a
33 951-tick run. Opening it **re-simulates** rather than restoring a state dump: the page seeds a world
from the link's own parameters, applies the event log at its recorded ticks, and runs to the shared
tick. That is the only representation that stays honest — a snapshot of the current world cannot tell a
replay from the real thing, and a run whose live parameters were edited mid-flight cannot be rebuilt
from the world's *current* parameters at all. `shareLink` therefore encodes the parameters the run
*started* with (the ones you loaded or saved), and the sliders that changed since are re-applied as
`params` events. The page says whether the rebuilt world's `stateHash` equals the sender's, and restores
it **paused** at the shared tick so it does not drift while you read the number. A link that cannot
round-trip is refused instead of half-loaded: a bad or truncated link, an out-of-range parameter, and a
run too long to replay (over 60 000 ticks) each get their own message. A plain reload picks up the
autosave — but an explicit `?seed=` does not, because asking for a seed means asking for that seed's
fresh world. A saved slot written in the old replay format still opens: the page reads the prefix and falls
back to replaying. Only a share link rebuilds by ticking, so that is where the page has to stay watchable:
during a link restore the arena shows `share link: replaying N of M ticks` over the world, the live sim is
parked for the duration (two runs on one CPU only split it), and the replay is fed in 40 ms slices so the page
keeps painting — measured 23 fps while a 7 995-tick run rebuilt itself in 19.9 s. A 150 ms slice, the size that
caused the owner's blank-arena-at-7-fps report, paints at 7 fps and fails the gate. The proof runs in two places: headless, where a scripted run (four live edits, a
bloom, a catastrophe, 6 500 ticks, three releases of engineered organisms) comes back with an identical
`stateHash`, and in Chrome, where the browser check clicks `share`, opens the link in a page that never
saw the run, and requires `stateHash` equality at the shared tick (7 995 ticks: 953 461 388 both sides) while
measuring the frame rate of the rebuild; then it reopens the page with no seed and no link and requires the
autosave to be an `EA2:` snapshot that lands on the tick it was written at (3 622) inside one 500 ms poll.

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
