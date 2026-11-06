// Headless arena run: prints the final report, the state hash, and throughput.
// Usage: node scripts/headless.ts [ticks] [seed]
import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const ticks = Number(process.argv[2] ?? 5000);
const seed = process.argv[3] ?? DEFAULT_PARAMS.seed;
if (!Number.isInteger(ticks) || ticks < 0) throw new Error(`bad tick count ${process.argv[2]}`);

const world = new World({ ...DEFAULT_PARAMS, seed });
const started = performance.now();
for (let i = 0; i < ticks; i++) world.step();
const ms = performance.now() - started;

const r = world.report();
const m = r.means;
console.log(
  `seed=${seed} ticks=${ticks} hash=${(world.stateHash() >>> 0).toString(16).padStart(8, '0')} ` +
    `pop=${r.organisms} food=${r.food} energy=${r.energy.toFixed(0)} gen=${r.meanGeneration.toFixed(2)}`,
);
console.log(
  `means radius=${m.radius.toFixed(2)} speed=${m.maxSpeed.toFixed(1)} sense=${m.senseRadius.toFixed(1)} ` +
    `meta=${m.metabolism.toFixed(3)} repro=${m.reproThreshold.toFixed(0)} seek=${m.seekFood.toFixed(2)} ` +
    `flee=${m.flee.toFixed(2)} wander=${m.wander.toFixed(2)}`,
);
console.log(`throughput: ${(ms / ticks).toFixed(3)} ms/tick, ${Math.round(ticks / (ms / 1000))} ticks/s`);
