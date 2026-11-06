import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, validateParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// The size-niche rule, proven at rule level so the population-scale result in
// test/food-web.long.test.ts has something to stand on. Big particles are the big morph's exclusive
// resource: that exclusivity is what makes the dwarf morph viable instead of a transitional tail.

/** A world with no spontaneous food and one stationary organism, so the only variable is the rule. */
function solo(params: Partial<typeof DEFAULT_PARAMS> = {}): World {
  const world = new World({
    ...DEFAULT_PARAMS,
    seed: 'food-web',
    startOrganisms: 1,
    startFood: 0,
    foodPerTick: 0,
    foodFloor: 0,
    predationEnabled: false,
    reseedOnEmpty: false,
    ...params,
  });
  const i = 0;
  world.gene.senseRadius[i] = 0;
  world.gene.wander[i] = 0;
  world.gene.maxSpeed[i] = 0;
  return world;
}

describe('size-structured food', () =>
  it.each([
    ['a dwarf', 4, false],
    ['a giant', 15, true],
  ])('%s %s handle a large particle', (_label, radius, edible) => {
    const world = solo();
    world.gene.radius[0] = radius;
    const before = world.energy[0];
    world.placeFood(world.x[0], world.y[0], true);
    world.step();

    if (edible) {
      expect(world.foodCount).toBe(0);
      expect(world.energy[0]).toBeGreaterThan(before);
    } else {
      // gape max(4, 0.55*4) = 4 < 8, so the particle stays and the organism starves on it
      expect(world.foodCount).toBe(1);
      expect(world.fr[0]).toBe(DEFAULT_PARAMS.bigFoodRadius);
      expect(world.energy[0]).toBeLessThan(before);
    }
  }));

describe('handling penalty', () => {
  // Same seed, same genome, same position: the only difference is what handling a too-small particle is
  // worth, so the energy deltas differ by exactly the penalised share of that particle.
  const delta = (radius: number, penalty: number): number => {
    const world = solo({ foodSmallPenalty: penalty });
    world.gene.radius[0] = radius;
    const before = world.energy[0];
    world.placeFood(world.x[0], world.y[0], false);
    world.step();
    return world.energy[0] - before;
  };

  it('cuts a giant almost off, but leaves it a lifeline', () => {
    // a hard inedibility block was tried and measured worse: the big morph starved with a stock of
    // large particles around it, so the exclusion is economic rather than physical
    expect(delta(15, 0)).toBeCloseTo(delta(15, 1) - DEFAULT_PARAMS.foodEnergy, 9);
  });

  it('does not apply when the particle suits the organism', () => {
    // particle 3 sits inside [0.25 * 4, max(4, 0.55 * 4)]
    expect(delta(4, 0)).toBeCloseTo(delta(4, 1), 9);
  });
});

describe('exclusivity', () => {
  // No organism in the arena can handle the large class, so every large particle spawned stays
  // unconsumed: that accumulating stock is the reservoir that favours the rare big morph.
  it('leaves every large particle uneaten while no organism is big enough', () => {
    const ticks = 1200;
    const world = new World({
      ...DEFAULT_PARAMS,
      seed: 'reservoir',
      startOrganisms: 40,
      startFood: 0,
      foodPerTick: 2,
      foodFloor: 0,
      bigFoodShare: 1,
      predationEnabled: false,
      reseedOnEmpty: false,
    });
    for (let i = 0; i < world.alive; i++) {
      world.gene.radius[i] = 4;
      world.gene.senseRadius[i] = 0;
      world.gene.maxSpeed[i] = 0;
    }

    for (let t = 0; t < ticks; t++) world.step();

    // the cap saturates well before the end, so any particle ever eaten would leave the count short
    expect(world.foodCount).toBe(Math.min(world.fr.length, 2 * ticks));
    for (let i = 0; i < world.foodCount; i++) expect(world.fr[i]).toBe(DEFAULT_PARAMS.bigFoodRadius);
    expect(world.alive).toBeLessThan(40); // they starve in sight of the food
  });
});

describe('param gates', () => {
  it('rejects a nonsensical size-niche parameter set', () => {
    expect(() => validateParams({ ...DEFAULT_PARAMS, bigFoodRadius: DEFAULT_PARAMS.foodRadius })).toThrow(
      /bigFoodRadius/,
    );
    expect(() => validateParams({ ...DEFAULT_PARAMS, bigFoodShare: 1.4 })).toThrow(/bigFoodShare/);
    expect(() => validateParams({ ...DEFAULT_PARAMS, foodMinShare: 3 })).toThrow(/foodMinShare/);
    expect(() => validateParams({ ...DEFAULT_PARAMS, foodSmallPenalty: 3 })).toThrow(/foodSmallPenalty/);
    expect(() => validateParams({ ...DEFAULT_PARAMS, foodGapeMin: 0 })).toThrow(/foodGapeMin/);
  });
});
