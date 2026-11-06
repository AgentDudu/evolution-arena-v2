import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, type GeneName } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const GENE_NAMES = Object.keys(GENES) as GeneName[];
const TEN_SIM_MINUTES = 600 / DEFAULT_PARAMS.dt; // 36000 ticks

// PLAN §14 item 3: the population must survive more than 10 sim-minutes and the gene means must
// visibly drift. Direction is not asserted — which traits win is a property of the seed and the
// food field, and hard-coding it would make the test a tautology.
describe('selection over long runs', () => {
  it(`survives ${TEN_SIM_MINUTES} ticks with no rescue reseeding and the mean genome drifts`, () => {
    // reseedOnEmpty off: a rescue spawn would hide an extinction, and extinction is what this
    // test is watching for.
    const world = new World({ ...DEFAULT_PARAMS, seed: 'arena-1', reseedOnEmpty: false });
    for (let i = 0; i < 500; i++) world.step();

    const early = world.report();
    expect(early.organisms).toBeGreaterThan(10);

    let minPopulation = early.organisms;
    while (world.tick < TEN_SIM_MINUTES) {
      world.step();
      if (world.tick % 1500 === 0) minPopulation = Math.min(minPopulation, world.alive);
    }

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
  }, 300_000);

  for (const seed of ['long-2', 'long-3']) {
    it(`seed ${seed} is still alive at 10000 ticks`, () => {
      const world = new World({ ...DEFAULT_PARAMS, seed, reseedOnEmpty: false });
      let minPopulation = world.alive;
      for (let i = 0; i < 10_000; i++) {
        world.step();
        if (i % 500 === 0) minPopulation = Math.min(minPopulation, world.alive);
      }
      expect(minPopulation).toBeGreaterThan(0);
      expect(world.alive).toBeGreaterThan(50);
    }, 180_000);
  }
});
