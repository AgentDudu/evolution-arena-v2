// Headless arena run: prints the final report, the state hash, and throughput. With
// --expose-gc it also prints the graph buffers and collected heap at checkpoints, which is how a
// full sim-hour (216000 ticks) is checked for memory growth without a browser.
// Usage: node scripts/headless.ts [ticks] [seed] [json param overrides]
import { DEFAULT_PARAMS, type SimParams } from '../src/core/config.ts';
import { MetricsHistory } from '../src/sim/history.ts';
import { World } from '../src/sim/world.ts';

const ticks = Number(process.argv[2] ?? 5000);
const seed = process.argv[3] ?? DEFAULT_PARAMS.seed;
function parseOverrides(raw: string | undefined): Partial<SimParams> {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw) as Partial<SimParams>;
  } catch {
    throw new Error(`param overrides must be JSON, got: ${raw}`);
  }
}

const overrides = parseOverrides(process.argv[4]);
if (!Number.isInteger(ticks) || ticks < 0) throw new Error(`bad tick count ${process.argv[2]}`);

const world = new World({ ...DEFAULT_PARAMS, seed, ...overrides });
const metrics = new MetricsHistory();
const collect = (globalThis as { gc?: () => void }).gc;
const checkpoint = Math.max(1, Math.round(ticks / 8));
const started = performance.now();
for (let i = 0; i < ticks; i++) {
  world.step();
  if (i % 15 === 0) metrics.sample(world.report());
  if ((i + 1) % checkpoint === 0) {
    collect?.();
    console.log(
      `  tick=${world.tick} pop=${world.alive} samples=${metrics.length}/${metrics.capacity} ` +
        `stride=${metrics.stride} heapMB=${(process.memoryUsage().heapUsed / 1048576).toFixed(1)}`,
    );
  }
}
const ms = performance.now() - started;

const r = world.report();
const m = r.means;
console.log(
  `seed=${seed} ticks=${ticks} hash=${(world.stateHash() >>> 0).toString(16).padStart(8, '0')} ` +
    `pop=${r.organisms} food=${r.food} energy=${r.energy.toFixed(0)} gen=${r.meanGeneration.toFixed(2)} species=${r.speciesCount}`,
);
console.log(
  `size classes: ${r.species.slice(0, 5).map((s) => `r${s.radius.toFixed(1)}×${s.count}`).join(' ') || 'none'}`,
);
console.log(
  `means radius=${m.radius.toFixed(2)} speed=${m.maxSpeed.toFixed(1)} sense=${m.senseRadius.toFixed(1)} ` +
    `meta=${m.metabolism.toFixed(3)} repro=${m.reproThreshold.toFixed(0)} seek=${m.seekFood.toFixed(2)} ` +
    `flee=${m.flee.toFixed(2)} wander=${m.wander.toFixed(2)}`,
);
console.log(`throughput: ${(ms / ticks).toFixed(3)} ms/tick, ${Math.round(ticks / (ms / 1000))} ticks/s`);
