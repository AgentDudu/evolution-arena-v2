import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, type GeneName } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const GENE_NAMES = Object.keys(GENES) as GeneName[];
const TEN_SIM_MINUTES = 600 / DEFAULT_PARAMS.dt; // 36000 ticks
const CHUNK = 1000;

// Vitest reports progress from the worker to the host over a channel with a fixed 60 second
// timeout that no config key raises (vitest#11082, #8164). One synchronous 60s+ loop trips it and
// the whole run exits 1 even when every test passed, so long arena runs are chunked with a yield
// between chunks.
async function runTicks(world: World, untilTick: number, onSample: (alive: number) => void): Promise<void> {
  while (world.tick < untilTick) {
    const stop = Math.min(untilTick, world.tick + CHUNK);
    while (world.tick < stop) world.step();
    onSample(world.alive);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// PLAN §14 item 3: the population must survive more than 10 sim-minutes and the gene means must
// visibly drift. Direction is not asserted — which traits win is a property of the seed and the
// food field, and hard-coding it would make the test a tautology.
describe('selection over long runs', () => {
  it(`survives ${TEN_SIM_MINUTES} ticks with no rescue reseeding and the mean genome drifts`, async () => {
    // reseedOnEmpty off: a rescue spawn would hide an extinction, and extinction is what this
    // test is watching for.
    const world = new World({ ...DEFAULT_PARAMS, seed: 'arena-1', reseedOnEmpty: false });
    await runTicks(world, 500, () => undefined);

    const early = world.report();
    expect(early.organisms).toBeGreaterThan(10);

    let minPopulation = early.organisms;
    await runTicks(world, TEN_SIM_MINUTES, (alive) => {
      minPopulation = Math.min(minPopulation, alive);
    });

    const late = world.report();
    expect(late.organisms).toBeGreaterThan(50);
    expect(minPopulation).toBeGreaterThan(0);

    let drifted = 0;
    for (const name of GENE_NAMES) {
      const range = GENES[name].max - GENES[name].min;
      const shift = Math.abs(late.means[name] - early.means[name]);
      expect(Number.isFinite(shift)).toBe(true);
      if (shift > 0.08 * range) drifted++;
    }
    expect(drifted).toBeGreaterThanOrEqual(3);
  });

  for (const seed of ['long-2', 'long-3']) {
    it(`seed ${seed} is still alive at 10000 ticks`, async () => {
      const world = new World({ ...DEFAULT_PARAMS, seed, reseedOnEmpty: false });
      let minPopulation = world.alive;
      await runTicks(world, 10_000, (alive) => {
        minPopulation = Math.min(minPopulation, alive);
      });
      expect(minPopulation).toBeGreaterThan(0);
      expect(world.alive).toBeGreaterThan(50);
    });
  }
});
