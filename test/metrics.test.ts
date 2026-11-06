import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { MetricsHistory } from '../src/sim/history.ts';
import { World } from '../src/sim/world.ts';

// Graph data structures: bounded memory is the item 6 done-when ("survives a 1-hour turbo run
// without heap growth"), so the buffer behaviour is proven here rather than by watching a browser.
describe('MetricsHistory', () => {
  const reportAt = (tick: number) => ({
    tick,
    organisms: 100 + tick,
    food: 50,
    energy: 1000,
    meanGeneration: 3,
    means: {
      radius: 10,
      maxSpeed: 60,
      senseRadius: 80,
      metabolism: 1,
      reproThreshold: 220,
      seekFood: 0.8,
      flee: 0.2,
      wander: 0.3,
      hue: 180,
    },
    species: [],
    speciesCount: 4,
    sizeBins: [],
    engineered: 0,
    engineeredMeanRadius: 0,
  });

  it('only samples every stride ticks', () => {
    const history = new MetricsHistory(8, 15);
    expect(history.sample(reportAt(0))).toBe(true);
    expect(history.sample(reportAt(5))).toBe(false);
    expect(history.sample(reportAt(14))).toBe(false);
    expect(history.sample(reportAt(15))).toBe(true);
    expect(history.length).toBe(2);
  });

  it('stays inside its capacity and keeps first, last, and monotonic ticks while downsampling', () => {
    const capacity = 8;
    const history = new MetricsHistory(capacity, 15);
    const total = 200;
    for (let n = 0; n < total; n++) history.sample(reportAt(n * 15));
    expect(history.length).toBeLessThanOrEqual(capacity);

    const ticks = history.tick.subarray(0, history.length);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    expect(ticks[0]).toBe(0); // the first sample survives
    // stride grows as the buffer halves, so a fed sample may be skipped; what must never happen is
    // the newest stored sample falling more than one stride behind the newest fed tick
    expect(ticks[ticks.length - 1]).toBeGreaterThan((total - 1) * 15 - history.stride);
    expect(history.stride).toBeGreaterThan(15); // it halved at least once
  });

  it('a full hour of samples never exceeds capacity, whatever the stride becomes', () => {
    const capacity = 512;
    const history = new MetricsHistory(capacity, 15);
    const ONE_HOUR_TICKS = 3600 / DEFAULT_PARAMS.dt; // 216000
    for (let tick = 0; tick <= ONE_HOUR_TICKS; tick += 15) history.sample(reportAt(tick));
    expect(history.length).toBeLessThanOrEqual(capacity);
    expect(history.tick[history.length - 1]).toBeGreaterThanOrEqual(ONE_HOUR_TICKS - history.stride);
    const covered = history.tick[history.length - 1] - history.tick[0];
    expect(covered).toBeGreaterThan(ONE_HOUR_TICKS * 0.9); // still shows most of the run
  });

  it('reset returns to an empty buffer with the original stride', () => {
    const history = new MetricsHistory(8, 15);
    for (let n = 0; n < 100; n++) history.sample(reportAt(n * 15));
    history.reset();
    expect(history.length).toBe(0);
    expect(history.stride).toBe(15);
    expect(history.sample(reportAt(500))).toBe(true);
    expect(history.tick[0]).toBe(500);
  });

  it('uPlotData returns a tick axis plus one equal-length array per column', () => {
    const history = new MetricsHistory(16, 15);
    for (let n = 0; n < 10; n++) history.sample(reportAt(n * 15));
    const data = history.uPlotData(['pop', 'species']);
    expect(data.length).toBe(3);
    for (const column of data) expect(column.length).toBe(10);
    expect(data[1][9]).toBe(100 + 9 * 15);
    expect(() => history.uPlotData(['nope' as 'pop'])).toThrow(/unknown|undefined/);
  });
});

describe('size bins and lineage tracking', () => {
  it('report size bins cover every organism and species are a filtered subset', () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'bins-1' });
    for (let i = 0; i < 500; i++) world.step();
    const report = world.report();
    const total = report.sizeBins.reduce((sum, bin) => sum + bin.count, 0);
    expect(total).toBe(world.alive);
    expect(report.species.length).toBeLessThanOrEqual(report.sizeBins.length);
    const minCount = world.params.speciesMinCount;
    for (const species of report.species) expect(species.count).toBeGreaterThanOrEqual(minCount);
    const radii = report.sizeBins.map((bin) => bin.radius);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it('slotOfLineage finds the organism again after the array compacts', () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'lineage-1', startFood: 1, foodPerTick: 0, reseedOnEmpty: false });
    world.alive = 0;
    world.foodCount = 0;
    for (let n = 0; n < 3; n++) {
      const i = world.alive++;
      world.x[i] = 100 + n * 200;
      world.y[i] = 100;
      world.prevX[i] = world.x[i];
      world.prevY[i] = world.y[i];
      world.energy[i] = 400;
      world.age[i] = 1;
      world.lineage[i] = 10 + n;
      for (const gene of Object.keys(world.gene) as (keyof typeof world.gene)[]) world.gene[gene][i] = 0.001;
      world.gene.radius[i] = 10;
      world.gene.reproThreshold[i] = 400; // no fission during the test
    }

    world.energy[1] = 0; // middle organism starves, so the swap-remove moves slot 2 into slot 1
    world.step();
    expect(world.alive).toBe(2);
    expect(world.slotOfLineage(11)).toBe(-1); // the starved lineage is gone
    const slot = world.slotOfLineage(12);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(world.lineage[slot]).toBe(12);
    expect(world.slotOfLineage(10)).toBe(0);
  });
});
