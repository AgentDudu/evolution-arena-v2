import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, type SimParams } from '../src/core/config.ts';
import { World, type WorldReport } from '../src/sim/world.ts';

const TICKS = 6000;

function evolve(seed: string, over: Partial<SimParams> = {}): WorldReport {
  const w = new World({ ...DEFAULT_PARAMS, seed, ...over });
  for (let i = 0; i < TICKS; i++) w.step();
  return w.report();
}

describe('the arena actually evolves', () => {
  const start = { ...DEFAULT_PARAMS };
  const end = evolve('behaviour');

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

  it('different seeds end at different trait distributions', () => {
    const a = evolve('seed-a');
    const b = evolve('seed-b');
    const distance =
      Math.abs(a.means.radius - b.means.radius) +
      Math.abs(a.means.senseRadius - b.means.senseRadius) +
      Math.abs(a.means.metabolism - b.means.metabolism);
    expect(distance).toBeGreaterThan(0.05);
  });
});
