import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, nextSpeed } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';
import { advance, createClock, runTimeBoxed } from '../src/sim/loop.ts';
import { hueBucket, HUE_BUCKETS, PALETTE, paletteKey } from '../src/render/palette.ts';

const newWorld = (): World => new World({ ...DEFAULT_PARAMS, seed: 'loop' });

describe('fixed-step loop', () => {
  it('cycles speed 1x -> 2x -> 4x -> 8x -> 1x, one key for all speeds', () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(8);
    expect(nextSpeed(8)).toBe(1);
    expect(nextSpeed(3)).toBe(1); // an off-list speed falls back to the first step
  });

  it('turbo time-box stops at the millisecond budget, always runs a tick, and honours the cap', () => {
    const world = newWorld();
    let calls = 0;
    const now = (): number => [0, 5, 9, 14, 20][Math.min(calls++, 4)];
    expect(runTimeBoxed(world, 100, 10, now)).toBe(3);
    expect(world.tick).toBe(3);

    const slow = newWorld();
    expect(runTimeBoxed(slow, 100, 0, () => 0)).toBe(1); // a machine over budget still advances

    const capped = newWorld();
    expect(runTimeBoxed(capped, 2, 1000, () => 0)).toBe(2);
  });

  it('advances exactly one tick when the budget is already spent', () => {
    // A bare `performance.now` reference loses its receiver in the browser (illegal invocation),
    // so the app passes an arrow; the sim layer takes the clock instead of reading it itself.
    const world = newWorld();
    expect(runTimeBoxed(world, 100, 0, () => performance.now())).toBe(1);
  });

  it('runs exactly the ticks that elapsed buys, at dt granularity', () => {
    const world = newWorld();
    const clock = createClock();
    const alpha = advance(world, clock, 1, 1, 1000);
    expect(world.tick).toBe(60);
    expect(alpha).toBeCloseTo(0, 10);
  });

  it('carries the remainder into the next call', () => {
    const world = newWorld();
    const clock = createClock();
    advance(world, clock, 0.025, 1, 1000); // 1.5 ticks worth
    expect(world.tick).toBe(1);
    expect(clock.accumulator).toBeCloseTo((1 / 60) * 0.5, 10);
    advance(world, clock, 0, 1, 1000);
    expect(world.tick).toBe(1);
    advance(world, clock, 1 / 60, 1, 1000); // half a tick left over + one tick worth
    expect(world.tick).toBe(2);
  });

  it('speed multiplies ticks without changing dt', () => {
    const slow = newWorld();
    const fast = newWorld();
    advance(slow, createClock(), 1, 1, 5000);
    advance(fast, createClock(), 1, 8, 5000);
    expect(slow.tick).toBe(60);
    expect(fast.tick).toBe(480);
    expect(fast.params.dt).toBe(DEFAULT_PARAMS.dt);
  });

  it('never advances the sim twice for the same elapsed time', () => {
    const world = newWorld();
    const clock = createClock();
    const first = world.stateHash();
    advance(world, clock, 0.5, 1, 1000);
    expect(world.stateHash()).not.toBe(first);
    const after = world.stateHash();
    advance(world, clock, 0, 0, 1000); // speed 0 = paused
    expect(world.stateHash()).toBe(after);
  });

  it('caps catch-up after a long stall instead of spiralling', () => {
    const world = newWorld();
    const clock = createClock();
    const alpha = advance(world, clock, 3600, 8, 50);
    expect(world.tick).toBe(50);
    expect(alpha).toBeLessThanOrEqual(50);
    expect(clock.accumulator).toBeLessThanOrEqual(DEFAULT_PARAMS.dt * 50 + 1e-12);
  });

  it('ignores negative elapsed time and negative speed', () => {
    const world = newWorld();
    advance(world, createClock(), -5, 4, 1000);
    advance(world, createClock(), 1, -4, 1000);
    expect(world.tick).toBe(0);
  });
});

describe('palette', () => {
  it('buckets every hue, including out-of-range ones', () => {
    for (const hue of [-720, -1, 0, 45, 180.5, 359.9, 360, 900]) {
      const b = hueBucket(hue);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HUE_BUCKETS);
    }
  });

  it('every palette key indexes a real colour', () => {
    for (const hue of [0, 30, 90, 200, 359]) {
      for (const fraction of [-0.5, 0, 0.2, 0.5, 0.9, 1, 4]) {
        const key = paletteKey(hue, fraction);
        expect(key).toBeGreaterThanOrEqual(0);
        expect(key).toBeLessThan(PALETTE.length);
        expect(PALETTE[key]).toMatch(/^hsl\(/);
      }
    }
  });
});
