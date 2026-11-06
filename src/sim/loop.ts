// Fixed-timestep driver. The simulation only ever advances by exactly params.dt, whatever the
// frame time is, so replays and speed changes never alter behaviour (PLAN §4).

import type { World } from '../sim/world.ts';

export interface Clock {
  accumulator: number;
}

export const createClock = (): Clock => ({ accumulator: 0 });

/** Run as many whole ticks as `elapsedSeconds * speed` buys, capped by maxTicksPerFrame.
 *  Returns the fraction of a tick left over, for render interpolation. */
export function advance(world: World, clock: Clock, elapsedSeconds: number, speed: number, maxTicksPerFrame: number): number {
  const dt = world.params.dt;
  clock.accumulator += Math.max(0, elapsedSeconds) * Math.max(0, speed);
  // Whole-tick count first, then one subtraction: a `while (acc >= dt)` loop loses a tick to
  // float error (60 seconds of 1/60 came out as 59).
  const wanted = Math.floor(clock.accumulator / dt + 1e-9);
  const ticks = Math.min(wanted, maxTicksPerFrame);
  for (let i = 0; i < ticks; i++) world.step();
  clock.accumulator -= ticks * dt;
  if (clock.accumulator < 0) clock.accumulator = 0;
  // A long stall (tab hidden, debugger) must not turn into an unbounded catch-up spiral.
  const ceiling = dt * maxTicksPerFrame;
  if (clock.accumulator > ceiling) clock.accumulator = ceiling;
  return clock.accumulator / dt;
}
