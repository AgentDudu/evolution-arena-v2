# Evolution Arena

Little creatures live in a box. They hunt, eat, grow, split in two, and get eaten by whatever is
bigger than them. Their young come out a little different from their parents, so after an hour of
running the population has changed shape on its own: a small form and a large form sharing the arena,
with nothing in between. Nobody steers it, and nothing in it is scripted.

![The first five seconds of one fresh world, recorded in real time: tick 52 to tick 351, 146 organisms
alive when the shutter closed. No input at all after the page loaded.](docs/media/arena.gif)

Under that sits a live 2D world with heritable traits, energy budgets, size-based predation, two
classes of food, and charts that fill in while it runs. The camera shows the whole arena from above:
no follow cam, no avatar, no score. Turbo runs about 15 simulated seconds per wall second, so **an
hour of world costs about four minutes** of yours.

```sh
pnpm install
pnpm dev            # http://localhost:5173 - the whole world is fitted to the window
```

## What is going on in there

- **Nothing is scripted.** Every organism has a heritable genome - radius, max speed, sense radius,
  metabolism, reproduction threshold, seek-food, flee, wander, hue (nine genes, radius spanning 4 to 16
  world units) - and passes a mutated copy of it on when it splits. Body colour comes from the hue gene,
  body lightness from energy reserves, so starvation is visible without a graph.
- **Energy is the only currency.** Moving, sensing and staying alive all cost. Eat or die; there is no
  other income.
- **Two classes of food, which is the whole trick.** Small green particles (radius 3, 25 energy) that
  anything can handle, and large yellow-green ones (radius 8, 60 energy) that only an organism of
  radius ~14.5 or more can swallow. The giant morph therefore owns a resource the dwarf morph cannot
  touch, so it recovers when rare instead of being bred out - right up against the radius ceiling of 16.
  Particles under an organism's handling size are still eaten, but worth only 15% - a giant can barely
  live on crumbs.
- **Predation is by size ratio,** with a refuge radius below which a small organism simply cannot be
  eaten, so the dwarf niche is not a death sentence either.

## Features

### Looking around and poking it

- Click the arena to drop food where the pointer is, and watch who gets there first.
- Shift+click an organism for its genome readout and sense radius. `i` isolates its lineage: everything
  else dims and its trail is drawn. The tracker follows the **lineage**, not an array slot, so it
  survives the compaction that happens whenever something dies.
- `space` pause, `n` one tick, `s` speed 1x -> 2x -> 4x -> 8x, `t` turbo (ticks until the frame budget
  is spent, still drawing).
- `e` arms a release: the next arena click drops 1-50 copies of the edited genome there instead of food,
  and one release per arming so a runaway click cannot bury the wild population. Released organisms and
  every descendant carry `origin 1`, so they are ringed in yellow in the arena and drawn as the yellow
  line of the population panel.
- `x` is delete mode, sticky because clearing a bad lineage means several clicks: each arena click then
  removes the organism whose body is under the pointer, with only 6 world units of slack since deleting
  the wrong one is worse than missing one.
- The `light` button switches the panel chrome dark or light and remembers the choice. The arena itself
  stays dark in either theme because the sim's colour language (yellow = engineered lineage) is
  calibrated against a dark field. Under 900 px wide the column becomes a sheet below the arena instead
  of disappearing.

### The right-hand panel

- One scroll list of cards - charts, sandbox, sim knobs, run - with the inspector pinned at its bottom,
  and `charts` / `sandbox` / `run` links in the header that jump straight to a card.
- Graphs for population, food, total energy, every trait mean as a share of its gene's range, species
  count, and the radius histogram.

### Sandbox: knobs and events

- Nine gene sliders plus **copy wild mean**, which loads the genome the population actually runs on so
  the experiment is one gene changed instead of a fantasy genome from the defaults.
- Six sliders and two checkboxes (food per tick, large-food share, crumb penalty, predation ratio, refuge
  radius, mutation rate, predation on/off, reseed when empty) apply to the **running** world, so you
  watch a rule change take effect instead of restarting.
- Three events: **food bloom** scatters particles up to `foodCap`, **catastrophe** kills on one rng coin
  flip per organism where they stand, **mutation burst** runs the ordinary fission mutation step over
  every genome once, which is how you push a genome without waiting for generations.
- Parameters that would resize the world's buffers or rewrite the run's identity are refused rather than
  half-applied; everything else goes through the same `validateParams` gate the world is built with.
- Every tool and event appends itself to `world.events`, so a run stays reproducible from
  (seed, params, ticks, events). Two identically seeded worlds that both hit `catastrophe(0.5)` at tick
  600 ended with the same kill count and the same `stateHash`.

### Save, share, replay

- `save` writes named slots, and an autosave fires every five seconds. Both store the **world itself**,
  so opening one costs one parse instead of one tick per tick: a tick-3 622 world (pop 1 278, 238 KB)
  was back on screen in 0.54 s, where the replay path needed 28 s for a run that size. The charts travel
  with the save, so reopening a run shows the curves you were looking at rather than an empty panel.
  Everything lives in `localStorage`; nothing leaves the browser.
- `share` (or `s`) builds a link, 875 characters for a 33 951-tick run. Opening it **re-simulates**: seed
  a world from the link's own parameters, apply the event log at its recorded ticks, run to the shared
  tick, then tell you whether the rebuilt world's `stateHash` equals the sender's. It restores
  **paused** so the run cannot drift while you read the number.
- A run that cannot round-trip is refused with its own message instead of half-loaded, and so is a save
  whose rebuilt world does not hash to what was written.
- A plain reload picks up the autosave. An explicit `?seed=` does not, because asking for a seed means
  asking for that seed's fresh world.

## The food web, in detail

Food comes in two classes: small green particles (radius 3, 25 energy) that any organism can handle,
and large yellow-green ones (radius 8, 60 energy) that only an organism of radius ~14.5 or more can
swallow. That exclusivity is the food web: the giant morph has a resource the dwarf morph cannot
touch, so it recovers when rare instead of being outbred. Particles below an organism handling size
are still eaten, but worth only 15% - a giant can barely live on crumbs, which is deliberate: making
crumbs outright inedible starved the giant morph with a stock of large particles it could not find.

## Designing a release that survives

A released creature has to be designed against the world it lands in, which is the interesting half
of the sandbox. Upkeep carries an `0.0008 * sense^2` term, so a genome with `senseRadius 150` pays 18
energy per tick where the population settled on ~1.7 (sense 46-55): measured, all 12 founders of such
a design were dead inside 100 ticks, and the same happens to a release that starts from the raw gene
defaults (senseRadius 80 = 5 energy per tick). That is why the panel has **copy wild mean** - the
experiment worth running is one gene changed on the genome the population already runs on. Measured
with `test/sandbox.long.test.ts`: wild-mean genome with only radius set to 15.5 on seed `release-mid`
went 12 founders -> 4 alive at +1200 ticks -> peak 19 at +3600 -> 6 at +12000, 8 generations, mean
radius held 15.38-15.57; a radius-5 design on `arena-1` was steadier at 12-17 descendants, 3
generations, radius 4.99-5.07. The wild population was not displaced in either case (1001-1353).

## License

MIT - see [LICENSE](LICENSE). No server, no accounts, no build artifacts committed: the sim, the charts and the
saves all live in one browser tab (`localStorage`), and `node scripts/headless.ts` runs the same world
with no browser at all.

## More

[docs/PLAN.md](docs/PLAN.md) is the build plan the whole thing follows, with the measured results that
justified each step and the ones that are still open.
