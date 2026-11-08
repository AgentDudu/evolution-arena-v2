import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, type SimParams } from '../src/core/config.ts';
import { World, type WorldReport } from '../src/sim/world.ts';

const TICKS = 6000;
const CHUNK = 1000;

// Chunked with a yield between chunks (as evolution.long.test.ts does): a synchronous 6000-tick loop
// starves the worker's progress channel to the host, whose 60 s timeout no config key raises
// (vitest#11082, #8164), and the run exits 1 with every assertion passed. It used to run here during
// *collection*, where nothing reports progress at all.
async function evolve(seed: string, over: Partial<SimParams> = {}): Promise<WorldReport> {
  const w = new World({ ...DEFAULT_PARAMS, seed, ...over });
  while (w.tick < TICKS) {
    const stop = Math.min(TICKS, w.tick + CHUNK);
    while (w.tick < stop) w.step();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return w.report();
}

describe('the arena actually evolves', () => {
  const start = { ...DEFAULT_PARAMS };
  let end: WorldReport;

  beforeAll(async () => {
    end = await evolve('behaviour');
  });

  it('keeps a living population instead of crashing or saturating the cap', () => {
    expect(end.organisms).toBeGreaterThan(50);
    expect(end.organisms).toBeLessThanOrEqual(start.maxOrganisms);
    expect(end.food).toBeGreaterThanOrEqual(0);
  });

  it('passes several generations', () => {
    expect(end.meanGeneration).toBeGreaterThanOrEqual(3);
  });

  it('selects on at least three traits independently', () => {
    // Random drift alone does not push several independent traits this far this fast; this is the
    // selection signature the whole design depends on. Founding means are the gene defaults.
    const moved = (end: number, founder: number): boolean => Math.abs(end - founder) > Math.abs(founder) * 0.03;
    const movers = [
      moved(end.means.radius, GENES.radius.def),
      moved(end.means.maxSpeed, GENES.maxSpeed.def),
      moved(end.means.senseRadius, GENES.senseRadius.def),
      moved(end.means.metabolism, GENES.metabolism.def),
      moved(end.means.seekFood, GENES.seekFood.def),
    ].filter(Boolean).length;
    expect(movers).toBeGreaterThanOrEqual(3);
  });

  it('different seeds end at different trait distributions', async () => {
    const a = await evolve('seed-a');
    const b = await evolve('seed-b');
    const distance =
      Math.abs(a.means.radius - b.means.radius) +
      Math.abs(a.means.senseRadius - b.means.senseRadius) +
      Math.abs(a.means.metabolism - b.means.metabolism);
    expect(distance).toBeGreaterThan(0.05);
  });
});
