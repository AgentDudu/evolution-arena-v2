import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const params = (over: Partial<SimParams> = {}): SimParams => ({ ...DEFAULT_PARAMS, ...over });
const run = (ticks: number, p: SimParams = params()): World => {
  const w = new World(p);
  for (let i = 0; i < ticks; i++) w.step();
  return w;
};

describe('World determinism', () => {
  it('replays to the same state hash for the same seed and params', () => {
    expect(run(5000).stateHash()).toBe(run(5000).stateHash());
  });

  it('replays to the same state hash for a numeric seed', () => {
    expect(run(2000, params({ seed: 4242 })).stateHash()).toBe(run(2000, params({ seed: 4242 })).stateHash());
  });

  it('diverges for different seeds', () => {
    const a = run(2000, params({ seed: 'arena-1' }));
    const b = run(2000, params({ seed: 'arena-2' }));
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('diverges when a single param changes', () => {
    const base = run(2000, params({ seed: 'arena-1' }));
    const faster = run(2000, params({ seed: 'arena-1', accel: 6 }));
    expect(faster.stateHash()).not.toBe(base.stateHash());
    const hungrier = run(2000, params({ seed: 'arena-1', foodPerTick: 8 }));
    expect(hungrier.stateHash()).not.toBe(base.stateHash());
  });

  it('reset() returns to the identical tick-0 world', () => {
    const w = run(1234, params({ seed: 'arena-3' }));
    const before = run(0, params({ seed: 'arena-3' })).stateHash();
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
