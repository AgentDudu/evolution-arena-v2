import { expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// Throughput guard, not a benchmark harness: it only fails if the tick pipeline regresses hard.
// Real numbers come from `pnpm bench` output and later from the dev HUD.
it('tick cost stays in the same order of magnitude at ~1000 organisms', () => {
  const world = new World({ ...DEFAULT_PARAMS, seed: 'bench' });
  for (let i = 0; i < 3000; i++) world.step();
  const started = performance.now();
  for (let i = 0; i < 1000; i++) world.step();
  const msPerTick = (performance.now() - started) / 1000;
  const report = world.report();
  // eslint-disable-next-line no-console
  console.log(
    `bench: pop=${report.organisms} food=${report.food} ${msPerTick.toFixed(3)} ms/tick ` +
      `${Math.round(1000 / msPerTick)} ticks/s`,
  );
  expect(msPerTick).toBeLessThan(8);
});
