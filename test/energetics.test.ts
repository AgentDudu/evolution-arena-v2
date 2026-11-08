import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, GENE_NAMES, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// "Traits cost fitness" is the claim the whole evolution story rests on: a bigger body, a longer sense
// organ and a faster swimmer all burn energy faster, so selection has something to push against.
// World.metabolise() is private, so these tests measure it from outside — two organisms that differ in
// exactly one gene, no food, no predation, and compare what their energy did over the same ticks.
//
// This file replaces a traits/costs module that was written earlier in the work but never committed,
// so it was lost when the working tree was cleaned; it is rebuilt from the cost table in world.ts.

const COST_PARAMS: SimParams = {
  ...DEFAULT_PARAMS,
  seed: 'cost-model',
  startFood: 1, // validateParams needs >= 1; the arena is emptied right after construction
  startOrganisms: 1, // likewise >= 1 and <= maxOrganisms; emptied below
  foodPerTick: 0,
  foodFloor: 0,
  maxOrganisms: 64,
  reseedOnEmpty: false,
  predationEnabled: false,
  mutationRate: 0,
};

function arena(overrides: Partial<SimParams> = {}): World {
  const world = new World({ ...COST_PARAMS, ...overrides });
  world.alive = 0;
  world.foodCount = 0;
  return world;
}

/** One organism with a known genome: every gene at its default unless the test overrides it. */
function add(world: World, px: number, py: number, genes: Partial<Record<(typeof GENE_NAMES)[number], number>>, energy = 400): number {
  const i = world.alive++;
  for (const name of GENE_NAMES) world.gene[name][i] = GENES[name].def;
  for (const [name, value] of Object.entries(genes) as [(typeof GENE_NAMES)[number], number][]) {
    world.gene[name][i] = value;
  }
  world.x[i] = px;
  world.y[i] = py;
  world.prevX[i] = px;
  world.prevY[i] = py;
  world.energy[i] = energy;
  return i;
}

/** Energy burned per tick, averaged over `ticks`, with the organism still alive at the end. */
function burn(world: World, index: number, ticks: number): number {
  const before = world.energy[index];
  for (let t = 0; t < ticks; t++) world.step();
  expect(world.alive, 'the organism survived the measurement window').toBeGreaterThan(0);
  return (before - world.energy[index]) / ticks;
}

// Sitting away from the walls, so a moving organism never bounces into a corner mid-measurement.
const MID = { x: DEFAULT_PARAMS.worldWidth / 2, y: DEFAULT_PARAMS.worldHeight / 2 };
const STILL = { maxSpeed: 0, senseRadius: 0, seekFood: 0, flee: 0, wander: 0 };

describe('what a body costs', () => {
  it('a bigger organism burns more per tick than a small one at rest', () => {
    const world = arena();
    const small = add(world, MID.x - 300, MID.y, { ...STILL, radius: GENES.radius.min });
    const big = add(world, MID.x + 300, MID.y, { ...STILL, radius: GENES.radius.max });
    const smallBurn = burn(world, small, 40);
    const bigBurn = burn(world, big, 40);
    expect(bigBurn).toBeGreaterThan(smallBurn * 2);
  });

  it('a longer sense organ costs more, at the same body size', () => {
    const world = arena();
    const short = add(world, MID.x - 300, MID.y, { ...STILL, radius: 8, senseRadius: GENES.senseRadius.min });
    const long = add(world, MID.x + 300, MID.y, { ...STILL, radius: 8, senseRadius: GENES.senseRadius.max });
    const shortBurn = burn(world, short, 40);
    const longBurn = burn(world, long, 40);
    expect(longBurn).toBeGreaterThan(shortBurn * 2);
  });

  it('a higher metabolism multiplier burns more, with everything else identical', () => {
    const world = arena();
    const slow = add(world, MID.x - 300, MID.y, { ...STILL, radius: 8, metabolism: GENES.metabolism.min });
    const fast = add(world, MID.x + 300, MID.y, { ...STILL, radius: 8, metabolism: GENES.metabolism.max });
    const slowBurn = burn(world, slow, 40);
    const fastBurn = burn(world, fast, 40);
    expect(fastBurn).toBeGreaterThan(slowBurn * 1.4);
  });

  it('moving costs energy a resting organism does not pay', () => {
    const world = arena();
    const rest = add(world, MID.x - 300, MID.y, { ...STILL, radius: 8 });
    const runner = add(world, MID.x + 300, MID.y, {
      radius: 8,
      senseRadius: 0,
      seekFood: 0,
      flee: 0,
      wander: 1,
      maxSpeed: GENES.maxSpeed.max,
    });
    const restBurn = burn(world, rest, 40);
    const runnerBurn = burn(world, runner, 40);
    expect(runnerBurn).toBeGreaterThan(restBurn);
    expect(Math.abs(world.x[runner] - MID.x), 'the runner actually went somewhere').toBeGreaterThan(1);
  });

  it('an organism at zero energy dies of it', () => {
    const world = arena();
    add(world, MID.x, MID.y, { ...STILL, radius: GENES.radius.max, metabolism: GENES.metabolism.max }, 0.5);
    for (let t = 0; t < 20 && world.alive > 0; t++) world.step();
    expect(world.alive).toBe(0);
  });
});
