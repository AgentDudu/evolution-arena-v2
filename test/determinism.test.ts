import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// Fast replay check. test/world.long.test.ts replays 10000-tick runs, which is too slow for an
// edit loop, so this keeps the determinism invariant in the quick lane at ~2 seconds.
const TICKS = 500;

function run(seed: string, overrides: Partial<SimParams> = {}): { hash: number; alive: number; meanRadius: number } {
  const world = new World({ ...DEFAULT_PARAMS, seed, ...overrides });
  for (let i = 0; i < TICKS; i++) world.step();
  return { hash: world.stateHash() >>> 0, alive: world.alive, meanRadius: world.report().means.radius };
}

describe('determinism (quick lane)', () => {
  it('one seed replays to exactly the same state', () => {
    expect(run('quick-det')).toEqual(run('quick-det'));
  });

  it('a different seed gives a different world', () => {
    expect(run('quick-det').hash).not.toBe(run('quick-det-b').hash);
  });

  it('one changed param gives a different world', () => {
    expect(run('quick-det', { foodEnergy: 26 }).hash).not.toBe(run('quick-det').hash);
  });

  it('reset returns the identical tick-0 world', () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'quick-det' });
    const atZero = world.stateHash() >>> 0;
    for (let i = 0; i < TICKS; i++) world.step();
    expect(world.stateHash() >>> 0).not.toBe(atZero);
    world.reset();
    expect(world.stateHash() >>> 0).toBe(atZero);
    expect(world.tick).toBe(0);
  });
});
