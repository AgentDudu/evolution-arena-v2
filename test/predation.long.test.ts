import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// Long predated runs. The rule itself is proven in test/predation.test.ts, which runs in the quick
// lane; these are the population-scale proofs and cost ~2 minutes, so they only run under `pnpm test`.

// Chunked with a yield every 1000 ticks: the vitest worker->host progress channel has a fixed 60s
// timeout with no config knob (vitest#11082, #8164).
async function run(world: World, untilTick: number, onSample: (world: World) => void): Promise<void> {
  while (world.tick < untilTick) {
    const stop = Math.min(untilTick, world.tick + 1000);
    while (world.tick < stop) world.step();
    onSample(world);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('predated populations', () => {
  it('does not crash the arena within 12000 ticks', async () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'pred-pop', reseedOnEmpty: false });
    await run(world, 12_000, (w) => {
      expect(w.alive).toBeGreaterThan(0);
    });
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
    await run(world, END, (w) => {
      const radii = w.report().species.map((s) => s.radius);
      const gap = radii.length >= 2 ? Math.max(...radii) - Math.min(...radii) : 0;
      if (gap >= 4) {
        if (streakStart < 0) streakStart = w.tick;
        longest = Math.max(longest, w.tick - streakStart + 1000);
      } else {
        streakStart = -1;
      }
    });
    expect(longest).toBeGreaterThanOrEqual(FIVE_MINUTE_TICKS);
    expect(world.alive).toBeGreaterThan(50);
  });
});
