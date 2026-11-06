import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, GENE_NAMES, type GeneName, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// Rule tests build their own two-organism arena: no food, no movement, no reproduction, so the only
// thing that can happen is the predation rule firing or not firing.
const RULE_PARAMS: SimParams = {
  ...DEFAULT_PARAMS,
  seed: 'pred-rule',
  startFood: 1, // validateParams needs >= 1; the arena is emptied right after construction
  startOrganisms: 1, // likewise >= 1 and <= maxOrganisms; emptied below
  foodPerTick: 0,
  foodFloor: 0,
  maxOrganisms: 64,
  reseedOnEmpty: false,
};

function arena(overrides: Partial<SimParams> = {}): World {
  const world = new World({ ...RULE_PARAMS, ...overrides });
  world.alive = 0;
  world.foodCount = 0;
  return world;
}

/** Static organism: speed and senses off, age below minAgeTicks, energy well under reproThreshold. */
function addOrganism(world: World, radius: number, px: number, py: number, energy = 150): number {
  const i = world.alive++;
  for (const name of GENE_NAMES) world.gene[name][i] = GENES[name].def;
  world.gene.radius[i] = radius;
  world.gene.maxSpeed[i] = 0;
  world.gene.senseRadius[i] = 0;
  world.gene.seekFood[i] = 0;
  world.gene.flee[i] = 0;
  world.gene.wander[i] = 0;
  world.x[i] = px;
  world.y[i] = py;
  world.prevX[i] = px;
  world.prevY[i] = py;
  world.energy[i] = energy;
  return i;
}

describe('predation rule', () => {
  it('an overlapping organism meaningfully bigger than its prey eats it and takes the energy', () => {
    const world = arena();
    const hunter = addOrganism(world, 16, 100, 100, 200);
    addOrganism(world, 10, 125, 100, 100); // distance 25 < 16 + 10, so they touch
    world.step();
    expect(world.alive).toBe(1);
    // +0.5 * victim energy, minus this tick's own metabolism
    expect(world.energy[hunter]).toBeGreaterThan(245);
    expect(world.energy[hunter]).toBeLessThanOrEqual(250);
  });

  it('a size ratio under predationRatio means no meal', () => {
    const world = arena();
    const hunter = addOrganism(world, 16, 100, 100, 200);
    const prey = addOrganism(world, 13, 128, 100, 100); // 13 * 1.25 = 16.25 > 16
    world.step();
    expect(world.alive).toBe(2);
    expect(world.energy[hunter]).toBeLessThan(200);
    expect(world.energy[prey]).toBeGreaterThan(0);
  });

  it('prey below the gape floor is ignored, and lowering the floor makes it edible', () => {
    const guarded = arena();
    addOrganism(guarded, 16, 100, 100, 200);
    addOrganism(guarded, 6, 115, 100, 100); // ratio allows it, preyMinRadius (9) does not
    guarded.step();
    expect(guarded.alive).toBe(2);

    const open = arena({ preyMinRadius: 5 });
    addOrganism(open, 16, 100, 100, 200);
    addOrganism(open, 6, 115, 100, 100);
    open.step();
    expect(open.alive).toBe(1);
  });

  it('juveniles under predatorMinRadius do not hunt', () => {
    const params = { preyMinRadius: 2.5 };
    const closed = arena(params);
    addOrganism(closed, 5, 100, 100, 200); // juvenile hunter
    addOrganism(closed, 3, 107, 100, 100);
    closed.step();
    expect(closed.alive).toBe(2);

    const adult = arena({ ...params, predatorMinRadius: 4 });
    addOrganism(adult, 5, 100, 100, 200);
    addOrganism(adult, 3, 107, 100, 100);
    adult.step();
    expect(adult.alive).toBe(1);
  });

  it('no meal without overlap', () => {
    const world = arena();
    addOrganism(world, 16, 100, 100, 200);
    addOrganism(world, 10, 140, 100, 100); // distance 40 > 26
    world.step();
    expect(world.alive).toBe(2);
  });

  it('one hunter takes one kill per tick', () => {
    const world = arena();
    addOrganism(world, 16, 100, 100, 200);
    addOrganism(world, 10, 125, 100, 100);
    addOrganism(world, 10, 75, 100, 100);
    world.step();
    expect(world.alive).toBe(2);
  });

  it('stolen energy is capped at reproThreshold * 2 like food energy', () => {
    const world = arena();
    const hunter = addOrganism(world, 16, 100, 100, 420); // cap = 220 * 2
    addOrganism(world, 10, 125, 100, 200);
    world.step();
    expect(world.alive).toBe(1);
    expect(world.energy[hunter]).toBeLessThanOrEqual(440);
    expect(world.energy[hunter]).toBeGreaterThan(430);
  });

  it('predation off leaves the same arena untouched', () => {
    const world = arena({ predationEnabled: false });
    addOrganism(world, 16, 100, 100, 200);
    addOrganism(world, 10, 125, 100, 100);
    world.step();
    expect(world.alive).toBe(2);
  });
});

describe('predated populations', () => {
  it('does not crash the arena within 12000 ticks', async () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'pred-pop', reseedOnEmpty: false });
    while (world.tick < 12_000) {
      const stop = Math.min(12_000, world.tick + 1000);
      while (world.tick < stop) world.step();
      expect(world.alive).toBeGreaterThan(0);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(world.alive).toBeGreaterThan(50);
  });

  // PLAN §14 item 4 done-when: two size morphs coexist for more than 5 sim-minutes. A morph is a
  // radius class with enough members to be real (speciesMinCount), and the two must be separated by
  // a size gap, not adjacent bins.
  it('keeps two separated size morphs for over 5 sim-minutes', async () => {
    const END = 27_000;
    const FIVE_MINUTE_TICKS = 300 / DEFAULT_PARAMS.dt; // 18000
    const world = new World({ ...DEFAULT_PARAMS, seed: 'morph-1', reseedOnEmpty: false });

    let streakStart = -1;
    let longest = 0;
    while (world.tick < END) {
      const stop = Math.min(END, world.tick + 1000);
      while (world.tick < stop) world.step();
      const species = world.report().species;
      const radii = species.map((s) => s.radius);
      const gap = radii.length >= 2 ? Math.max(...radii) - Math.min(...radii) : 0;
      if (gap >= 4) {
        if (streakStart < 0) streakStart = world.tick;
        longest = Math.max(longest, world.tick - streakStart + 1000);
      } else {
        streakStart = -1;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(longest).toBeGreaterThanOrEqual(FIVE_MINUTE_TICKS);
    expect(world.alive).toBeGreaterThan(50);
  });
});
