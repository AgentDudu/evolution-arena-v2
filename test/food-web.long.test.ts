import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// The size-niche mechanism at population scale. test/food-web.test.ts proves the rule; this proves
// the rule produces two standing size morphs rather than a transient, and it does so on more than one
// seed, because a single seed can look bimodal by founder luck (measured: metaK tuning was bimodal on
// arena-1 and a dwarf monopoly on long-2).

async function run(world: World, untilTick: number, onSample: (world: World) => void): Promise<void> {
  while (world.tick < untilTick) {
    const stop = Math.min(untilTick, world.tick + 1000);
    while (world.tick < stop) world.step();
    onSample(world);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Two standing morphs, measured the way scripts/foodweb.ts reports them: the p90-p10 radius spread
 * plus how many organisms sit in each band. `speciesMinCount` bins alone are not enough - a single
 * stray organism in a far bin would otherwise count as a morph (that is what failed the first run).
 */
function morphs(world: World): { spread: number; dwarf: number; giant: number } {
  const radii = world.gene.radius.subarray(0, world.alive);
  if (radii.length === 0) return { spread: 0, dwarf: 0, giant: 0 };
  const sorted = Float64Array.from(radii).sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  let dwarf = 0;
  let giant = 0;
  for (const r of sorted) {
    if (r < world.params.preyMinRadius) dwarf++;
    else if (r > 13) giant++;
  }
  return { spread: at(0.9) - at(0.1), dwarf, giant };
}

describe('size-niche food web', () => {
  it.each(['niche-1', 'niche-2', 'niche-3'])('keeps a dwarf and a giant morph on seed %s', async (seed) => {
    const END = 27_000; // 7.5 sim-minutes
    const world = new World({ ...DEFAULT_PARAMS, seed, reseedOnEmpty: false });

    let samples = 0;
    let both = 0;
    let minDwarf = Infinity;
    let minGiant = Infinity;
    let minSpread = Infinity;
    await run(world, END, (w) => {
      const m = morphs(w);
      const share = w.alive;
      samples++;
      if (m.spread >= 4 && m.dwarf >= share * 0.05 && m.giant >= share * 0.05) {
        both++;
        minDwarf = Math.min(minDwarf, m.dwarf);
        minGiant = Math.min(minGiant, m.giant);
        minSpread = Math.min(minSpread, m.spread);
      }
    });

    // measured on these seeds: spread 8.2-11.4, dwarfs 25-73% of the population, giants 27-50%,
    // with nothing in between (disruptive selection). The thresholds below sit well clear of that.
    expect(both / samples).toBeGreaterThan(0.9);
    expect(minSpread).toBeGreaterThanOrEqual(4);
    expect(minDwarf).toBeGreaterThanOrEqual(DEFAULT_PARAMS.speciesMinCount);
    expect(minGiant).toBeGreaterThanOrEqual(DEFAULT_PARAMS.speciesMinCount);
    expect(world.alive).toBeGreaterThan(50);
  });

  // The mechanism claim, not just the outcome: while nothing can handle the large class, the large
  // class accumulates. That stock is what makes the big morph the rare-morph favourite.
  it('holds a reservoir of large particles the dwarf morph cannot spend', async () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'niche-reservoir', reseedOnEmpty: false });
    let big = 0;
    let total = 0;
    await run(world, 9_000, (w) => {
      let b = 0;
      for (let i = 0; i < w.foodCount; i++) if ((w.fr[i] ?? 0) >= DEFAULT_PARAMS.bigFoodRadius) b++;
      big = b;
      total = w.foodCount;
    });
    expect(total).toBeGreaterThan(0);
    expect(big).toBeGreaterThanOrEqual(Math.floor(total * DEFAULT_PARAMS.bigFoodShare * 0.5));
  });
});
