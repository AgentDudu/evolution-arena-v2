import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const params = (over: Partial<SimParams> = {}): SimParams => ({ ...DEFAULT_PARAMS, ...over });

// Chunked with a yield between chunks, the same way evolution.long.test.ts does it: one synchronous
// loop over thousands of ticks starves the worker's progress channel to the host, which has a fixed
// 60 s timeout no config key raises (vitest#11082, #8164), and the run exits 1 even though every
// assertion passed. 5000 ticks is ~21 s alone and well over a minute with 18 files in parallel.
const CHUNK = 1000;

async function run(ticks: number, p: SimParams = params()): Promise<World> {
  const w = new World(p);
  while (w.tick < ticks) {
    const stop = Math.min(ticks, w.tick + CHUNK);
    while (w.tick < stop) w.step();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return w;
}

describe('World determinism', () => {
  it('replays to the same state hash for the same seed and params', async () => {
    expect((await run(5000)).stateHash()).toBe((await run(5000)).stateHash());
  });

  it('replays to the same state hash for a numeric seed', async () => {
    const a = await run(2000, params({ seed: 4242 }));
    const b = await run(2000, params({ seed: 4242 }));
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('diverges for different seeds', async () => {
    const a = await run(2000, params({ seed: 'arena-1' }));
    const b = await run(2000, params({ seed: 'arena-2' }));
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('diverges when a single param changes', async () => {
    const base = await run(2000, params({ seed: 'arena-1' }));
    const faster = await run(2000, params({ seed: 'arena-1', accel: 6 }));
    expect(faster.stateHash()).not.toBe(base.stateHash());
    const hungrier = await run(2000, params({ seed: 'arena-1', foodPerTick: 8 }));
    expect(hungrier.stateHash()).not.toBe(base.stateHash());
  });

  it('reset() returns to the identical tick-0 world', async () => {
    const w = await run(1234, params({ seed: 'arena-3' }));
    const before = (await run(0, params({ seed: 'arena-3' }))).stateHash();
    w.reset();
    expect(w.stateHash()).toBe(before);
  });

  it('the hash moves every tick, so it can detect any divergence', () => {
    const w = new World(params({ seed: 'arena-4' }));
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      w.step();
      seen.add(w.stateHash());
    }
    expect(seen.size).toBe(50);
  });
});
