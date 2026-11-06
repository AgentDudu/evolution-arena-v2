import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, type SimParams } from '../src/core/config.ts';
import { MetricsHistory } from '../src/sim/history.ts';
import { World } from '../src/sim/world.ts';

// The sandbox release tool. test/sandbox.long.test.ts asks whether a released lineage can hold its
// own against the wild population; this file pins the rules that make that measurable: the exact
// genome reaches the world, the origin marker survives fission, and the graph column exists.

const solo = (overrides: Partial<SimParams> = {}): World =>
  new World({
    ...DEFAULT_PARAMS,
    seed: 'sandbox',
    startOrganisms: 1,
    startFood: 0,
    foodPerTick: 0,
    foodFloor: 0,
    predationEnabled: false,
    reseedOnEmpty: false,
    ...overrides,
  });

describe('engineer', () => {
  it('places the exact genome at the requested point', () => {
    const world = solo();
    const slot = world.engineer(100, 200, { radius: 5, hue: 300, maxSpeed: 100 });
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(world.gene.radius[slot]).toBe(5);
    expect(world.gene.hue[slot]).toBe(300);
    expect(world.gene.maxSpeed[slot]).toBe(100);
    // genes the editor leaves alone fall back to gene defaults, not to whatever the slot held last
    expect(world.gene.senseRadius[slot]).toBe(GENES.senseRadius.def);
    expect(world.x[slot]).toBe(100);
    expect(world.y[slot]).toBe(200);
    expect(world.report().engineered).toBe(1);
  });

  it('clamps a genome the genetics cannot express', () => {
    const world = solo();
    const slot = world.engineer(1, 1, { radius: 999, metabolism: -5, reproThreshold: 1 });
    expect(world.gene.radius[slot]).toBe(GENES.radius.max);
    expect(world.gene.metabolism[slot]).toBe(GENES.metabolism.min);
    expect(world.gene.reproThreshold[slot]).toBe(GENES.reproThreshold.min);
    // a radius-16 organism cannot sit flush against the wall
    expect(world.x[slot]).toBe(GENES.radius.max);
    expect(world.y[slot]).toBe(GENES.radius.max);
  });

  it('marks descendants, not only the organism that was released', () => {
    const world = solo();
    const slot = world.engineer(400, 300, { radius: 6 });
    // reproduction needs energy and age, both of which the test sets directly
    world.energy[slot] = world.gene.reproThreshold[slot] * 2;
    world.age[slot] = DEFAULT_PARAMS.minAgeTicks;
    world.step();
    expect(world.report().engineered).toBe(2);
  });

  it('leaves the wild population unmarked', () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'arena-1' });
    for (let i = 0; i < 300; i++) world.step();
    expect(world.report().engineered).toBe(0);
    world.engineer(300, 300, { radius: 7 });
    expect(world.report().engineered).toBe(1);
    expect(world.report().engineeredMeanRadius).toBe(7);
  });

  it('shares the population cap with the wild population', () => {
    const world = solo({ maxOrganisms: 10 });
    let placed = 0;
    for (let k = 0; k < 30; k++) if (world.engineer(100 + k * 3, 100, { radius: 6 }) >= 0) placed++;
    // the seeded organism holds a slot, so only nine releases fit
    expect(placed).toBe(9);
    expect(world.report().engineered).toBe(9);
    expect(world.alive).toBe(10);
  });

  it('feeds the engineered column the population graph draws', () => {
    const world = solo();
    world.engineer(100, 100, { radius: 6 });
    const history = new MetricsHistory(8, 1);
    expect(history.sample(world.report())).toBe(true);
    expect(history.series.engineered[0]).toBe(1);
  });
});
