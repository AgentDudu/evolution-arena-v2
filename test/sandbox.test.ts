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

describe('sandbox tools and events', () => {
  const wild = (overrides: Partial<SimParams> = {}): World => new World({ ...DEFAULT_PARAMS, seed: 'tools', ...overrides });

  it('deleteAt removes exactly that organism and compacts', () => {
    const world = wild({ startOrganisms: 200 });
    for (let i = 0; i < 60; i++) world.step();
    const before = world.alive;
    const target = 5;
    const deletedLineage = world.lineage[target];
    const lastLineage = world.lineage[before - 1];
    expect(world.deleteAt(target)).toBe(true);
    expect(world.alive).toBe(before - 1);
    // swap-remove: the last organism moves into the freed slot, and the deleted lineage is gone
    expect(world.lineage[target]).toBe(lastLineage);
    expect(world.slotOfLineage(deletedLineage)).toBe(-1);
    expect(world.deleteAt(99_999)).toBe(false);
    expect(world.deleteAt(-1)).toBe(false);
  });

  it('changes the running sim, and refuses the keys that size the arena', () => {
    const params: SimParams = {
      ...DEFAULT_PARAMS,
      seed: 'tools',
      startOrganisms: 60,
      startFood: 0,
      foodPerTick: 0,
      foodFloor: 0,
    };
    const world = new World(params);
    world.setParams({ foodPerTick: 40 });
    for (let i = 0; i < 20; i++) world.step();
    expect(world.foodCount).toBeGreaterThan(0);
    // the world owns a copy: editing it live must not reach through to the caller's params object
    expect(params.foodPerTick).toBe(0);
    expect(() => world.setParams({ maxOrganisms: 50 })).toThrow(/cannot change mid-run/);
    expect(() => world.setParams({ worldWidth: 10 })).toThrow(/cannot change mid-run/);
    expect(() => world.setParams({ foodPerTick: -5 })).toThrow(/invalid SimParams/);
    expect(world.params.foodPerTick).toBe(40);
    expect(world.params.maxOrganisms).toBe(DEFAULT_PARAMS.maxOrganisms);
  });

  it('catastrophe is deterministic, so a shared world replays the same survivors', () => {
    const run = (): { alive: number; killed: number; hash: number; before: number } => {
      const world = new World({ ...DEFAULT_PARAMS, seed: 'bottleneck', startOrganisms: 400 });
      for (let i = 0; i < 600; i++) world.step();
      const before = world.alive;
      const killed = world.catastrophe(0.5);
      return { alive: world.alive, killed, hash: world.stateHash(), before };
    };
    const a = run();
    const b = run();
    expect(a.before).toBeGreaterThan(300);
    expect(a.killed).toBe(b.killed);
    expect(a.alive).toBe(b.alive);
    expect(a.hash).toBe(b.hash);
    // a coin flip over hundreds of organisms lands near its stated fraction
    expect(a.killed).toBeGreaterThan(a.before * 0.35);
    expect(a.killed).toBeLessThan(a.before * 0.65);
  });

  it('foodBloom stops at the cap and mutationBurst keeps genomes expressible', () => {
    const world = wild({ startFood: DEFAULT_PARAMS.foodCap - 20 });
    expect(world.foodCount).toBe(DEFAULT_PARAMS.foodCap - 20);
    expect(world.foodBloom(500)).toBe(20); // foodCap stays a hard ceiling
    expect(world.foodCount).toBe(DEFAULT_PARAMS.foodCap);

    const radii = Float64Array.from(world.gene.radius.subarray(0, world.alive));
    world.mutationBurst();
    let changed = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < world.alive; i++) {
      if (world.gene.radius[i] !== radii[i]) changed++;
      min = Math.min(min, world.gene.radius[i]);
      max = Math.max(max, world.gene.radius[i]);
    }
    expect(changed).toBeGreaterThan(0);
    expect(min).toBeGreaterThanOrEqual(GENES.radius.min);
    expect(max).toBeLessThanOrEqual(GENES.radius.max);
  });

  it('organismAt hits the body under a point and refuses a point in open water', () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'click', maxOrganisms: 10, startOrganisms: 1, startFood: 0 });
    expect(world.alive).toBe(1);
    expect(world.organismAt(world.x[0], world.y[0])).toBe(0);
    // the opposite corner of the arena, well beyond any body plus the slack
    const far = world.organismAt(
      world.params.worldWidth - world.x[0],
      world.params.worldHeight - world.y[0],
    );
    expect(far).toBe(-1);
    expect(world.deleteAt(far)).toBe(false);
    expect(world.alive).toBe(1);
    expect(world.deleteAt(world.organismAt(world.x[0], world.y[0]))).toBe(true);
    expect(world.alive).toBe(0);
  });

  it('records every perturbation with the tick it happened on', () => {
    const world = wild();
    for (let i = 0; i < 45; i++) world.step();
    world.foodBloom(5);
    world.catastrophe(0.1);
    world.mutationBurst();
    world.deleteAt(0);
    world.setParams({ predationRatio: 1.6 });
    expect(world.events.map((e) => e.kind)).toEqual(['foodBloom', 'catastrophe', 'mutationBurst', 'delete', 'params']);
    expect(world.events[0].tick).toBe(45);
    expect(world.events[4].patch).toEqual({ predationRatio: 1.6 });
    expect(world.params.predationRatio).toBe(1.6);
  });
});
