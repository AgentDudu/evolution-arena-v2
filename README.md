# Evolution Arena

A closed world of organisms nobody controls. Each one hunts food, burns energy, grows, splits into a
mutated copy of itself, and gets eaten if something bigger finds it first. Run an hour of it and the
population grows its own size structure — a dwarf morph and a giant morph sharing the arena, with
nothing in between. Nobody was told to be small or large. The food web is what decided it.

![The arena at tick 71 781 of one seeded run, turbo on: 1 626 organisms alive, 671 of them at radius
12 or more and the largest at 16, the top of the allowed range, over a canvas that is 39% non-background
pixels. Nothing was added to this world by hand.](docs/media/arena.png)

Aerial view of the whole arena — no follow camera, no avatar, no score. Turbo ticks ~15 sim-seconds
per wall second, so **a simulated hour takes about four minutes** of your time.

```sh
pnpm install
pnpm dev            # http://localhost:5173 — the whole world is fitted to the window
```

## What is going on in there

- **Nothing is scripted.** Every organism has a heritable genome — radius, max speed, sense radius,
  metabolism, reproduction threshold, seek-food, flee, wander, hue (nine genes, radius spanning 4 to 16
  world units) — and passes a mutated copy of it on when it splits. Body colour comes from the hue gene,
  body lightness from energy reserves, so starvation is visible without a graph.
- **Energy is the only currency.** Moving, sensing and staying alive all cost. Eat or die; there is no
  other income.
- **Two classes of food, which is the whole trick.** Small green particles (radius 3, 25 energy) that
  anything can handle, and large yellow-green ones (radius 8, 60 energy) that only an organism of
  radius ~14.5 or more can swallow. The giant morph therefore owns a resource the dwarf morph cannot
  touch, so it recovers when rare instead of being bred out — right up against the radius ceiling of 16.
  Particles under an organism's handling size are still eaten, but worth only 15% — a giant can barely
  live on crumbs.
- **Predation is by size ratio,** with a refuge radius below which a small organism simply cannot be
  eaten, so the dwarf niche is not a death sentence either.
- **You can intervene, and it is logged.** Nine gene sliders, a *copy wild mean* button, click-to-drop
  food, delete mode, and three events (food bloom, catastrophe, mutation burst). Every one of them is
  appended to the run's event log, so the run stays reproducible from (seed, params, ticks, events).

## Five things worth trying

1. Press `t` (turbo) and leave it ~4 minutes. The charts are the story: population, total energy, the
   mean of every gene, species count, and the radius histogram developing two humps.
2. Click anywhere: you just dropped food there. Watch who arrives first — that is selection for speed
   and sense radius, live.
3. Shift+click an organism for its genome readout and sense radius, then `i` to isolate its lineage:
   everything else dims and its trail is drawn. The tracker follows the **lineage**, not an array slot,
   so it survives the compaction that happens whenever something dies.
4. Build something. Sandbox → **copy wild mean** → set radius 15.5 → `e` → click to release up to 50
   copies. Your lineage and its descendants are ringed in yellow and drawn as the yellow line of the
   population panel. One catch, and it is the interesting part: upkeep carries an `0.0008 * sense^2`
   term, so a genome at `senseRadius 150` pays 18 energy per tick where the population settled on ~1.7.
   Measured: all 12 founders of such a design were dead inside 100 ticks. Design against the world you
   are dropping into, not against the gene defaults.
5. Press **catastrophe** (each organism flips one rng coin and dies on a loss), then watch the radius
   histogram refill. The giant class comes back because the large particles it alone can swallow are
   still sitting there uneaten — that reservoir is why being rare is not the end for it, and
   `node scripts/foodweb.ts 216000 arena-1` prints that reservoir every simulated minute.

## Numbers here are measured, not asserted

- 912 ticks/s at population 651 while painting at 57 fps. The floor (>= 450 ticks/s at pop >= 500 under
  turbo, >= 45 fps, no frame gap over 60 ms) is one of the things `pnpm browser-check` fails a build on.
- Two identically seeded worlds that both hit `catastrophe(0.5)` at tick 600 ended with the same kill
  count and the same `stateHash`. A restored run that hashes differently is refused rather than shown.
- A `save` snapshot lands a tick-3 622 world (pop 1 278, 238 KB) on screen in 0.54 s; the replay path
  needs 28 s for a run that size. Share links are 875 characters for a 33 951-tick run.
- 133 tests (`pnpm test`, ~4 min) or 110 in ~15 s (`pnpm test:quick`), plus the browser check.

Everything below is the detail: the panel, the sandbox, the save/share format, and the gates.
Planning: [docs/PLAN.md](docs/PLAN.md)

## Status

Items 1-7 of the plan are in. Deterministic core (seeded PRNG, spatial hash, fixed-tick
pipeline), aerial Canvas 2D renderer with play/pause/step/speed/turbo, selection that
measurably moves the mean genome over 10 sim-minutes, and a size-structured food web that keeps a dwarf
morph (r 4-8) and a giant morph (r ~15) side by side for a **full sim hour** on three seeds, with
nothing in between. Plus a graphs column (population, energy, trait means, species, size histogram),
a per-organism inspector, and the sandbox: nine gene sliders, a "copy wild mean" button, arm + click to
drop a designed genome into the running world, a delete mode, six sim sliders and two checkboxes that
apply to the running world, and three events (food bloom, catastrophe, mutation burst). Save and share:
`save` snapshots the world, `share` builds a link that rebuilds the identical world in another browser,
and reopening the page picks up the last run. The performance pass (item 8) is in: a full arena ticks
2× faster than it did — the grid evaluates the prey / threat / edible accept test inline, and one walk
now answers both the prey and the threat question instead of walking the same cells twice — with the
state hash unchanged bit for bit. The throughput floor (>= 450 ticks/s at pop >= 500 under turbo, >= 45
fps, no frame gap over 60 ms) is one of the things `pnpm browser-check` fails a build on; measured here
it runs 912 ticks/s at pop 651 while painting at 57 fps.

## Commands

```sh
pnpm test                         # everything: 133 tests, ~4 min (long arena runs dominate)
pnpm test:quick                   # same suite minus *.long.test.ts: 110 tests, ~15 s — the edit loop
pnpm typecheck
node scripts/headless.ts 36000    # [ticks] [seed] [json params] -> report + species + state hash
node --expose-gc scripts/headless.ts 216000 arena-1   # a sim-hour soak: buffers + collected heap
node scripts/foodweb.ts 216000 arena-1  # size structure every sim-minute: radius percentiles,
                                  # morph counts, large-particle reservoir. [ticks] [seed] [json params]
pnpm build && npx vite preview --port 4321
pnpm browser-check http://localhost:4321/?seed=check 4 240   # headless Edge over CDP: ticks/s, painted
                                  # pixels, 4 graph panels, then 240 s turbo soak with heap per 10 s
```

## CI, and why it ships switched off

There is a CI workflow, `.github/workflows/ci.yml.disabled`, and it is **switched off**: rename it to
`ci.yml` to enable. It is off because no GitHub-hosted runner is provisioned for this account — every
job, including a one-step `echo`, fails in ~4 s with `runner_id=0` and no log — so an enabled workflow
would put a red X on every push for a reason that is not the code. When runners work, it runs typecheck
+ `test:quick` + build on every push and pull request, and the full `pnpm test` on a merge.
`browser-check` is not in CI either way: it drives a real headless Edge over CDP and that toolchain is
not on a runner. So today every gate below is run by hand, and `browser-check` is the only thing that
proves the UI, the replay, the restore, and the throughput floor.

## Controls

Click = drop food, shift+click = inspect an organism (genome readout + sense radius),
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

## The right-hand panel

The column is one scroll list of cards — charts, sandbox, sim knobs, run — with the inspector **pinned**
at its bottom, so the genome readout is reachable without scrolling past the run buttons, and the
`charts` / `sandbox` / `run` links in its header jump straight to a card. The `light` button switches the
panel chrome dark ↔ light and remembers the choice; the arena and the plot surfaces stay dark in either
theme because the sim's colour language (yellow = engineered lineage) is calibrated against a dark
field. Under 900 px wide the column becomes a sheet below the arena instead of disappearing, which is
what it used to do on a phone.

## Sandbox, knobs, and events

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

## Save, share, replay

Two formats, because they answer different questions. A `save` (named slots) and
the autosave that fires every five seconds store the **world itself**: organism and food arrays as base64
typed arrays plus params, event log and counters, prefixed `EA2:`, into `arena.slots.v1` / `arena.autosave.v1`.
Opening one costs one parse, not one tick per tick — measured: tick 3 622 (pop 1 278, 238 KB) back on screen
in 0.54 s, where the replay path needed 28 s for a run of the same size. A snapshot also carries the four
words of the sim's PRNG and the food pacing accumulator, so the run *continues* identically rather than merely
looking right at the saved tick — `test/snapshot.test.ts` steps both worlds 300 further ticks and requires the
hashes to still agree. The **graphs travel with the save too**: the sampled metric series ride in the same payload
(88 bytes per sample, up to ~120 KB at the buffer's 1 024-sample capacity), so reopening a run shows the curves you
were looking at rather than an empty chart filling in from the restore tick. A save is refused unless the world it
rebuilds hashes to what was written, so a truncated or
edited save says so instead of loading a subtly different run. They live in localStorage only: 250–360 KB for a
full arena, and a write the browser refuses is said once and then
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
caused the owner's blank-arena-at-7-fps report, paints at 7 fps and fails the gate. A replayed run gets its charts
back as a side effect of rebuilding: the ticks are being simulated anyway, so the metric series are sampled as they
land, at a steady stride instead of once per wall-clock quarter second — 63 samples live became 513 rebuilt. The proof runs in two places: headless, where a scripted run (four live edits, a
bloom, a catastrophe, 6 500 ticks, three releases of engineered organisms) comes back with an identical
`stateHash`, and in Chrome, where the browser check clicks `share`, opens the link in a page that never
saw the run, and requires `stateHash` equality at the shared tick (7 995 ticks: 953 461 388 both sides) while
measuring the frame rate of the rebuild and that the charts came with it (513 samples up to tick 7 681 of 7 685);
then it reopens the page with no seed and no link and requires the
autosave to be an `EA2:` snapshot that lands on the tick it was written at (3 622) inside one 500 ms poll, with the
same number of graph samples as the save held (55 in, 55 out).

## The food web, in detail

Food comes in two classes: small green particles (radius 3, 25 energy) that any organism can handle,
and large yellow-green ones (radius 8, 60 energy) that only an organism of radius ~14.5 or more can
swallow. That exclusivity is the food web: the giant morph has a resource the dwarf morph cannot
touch, so it recovers when rare instead of being outbred. Particles below an organism handling size
are still eaten, but worth only 15% — a giant can barely live on crumbs, which is deliberate: making
crumbs outright inedible starved the giant morph with a stock of large particles it could not find.

## Designing a release that survives

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

## License

MIT — see [LICENSE](LICENSE). No server, no accounts, no build artifacts committed: the sim, the charts and the
saves all live in one browser tab (`localStorage`), and `node scripts/headless.ts` runs the same world
with no browser at all.
