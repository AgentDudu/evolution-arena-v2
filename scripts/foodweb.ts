// Size-structure probe: prints radius percentiles and morph counts every sim-minute, so food-web
// questions (why do giants take over? does the dwarf refugium hold?) are answered with numbers.
// Usage: node scripts/foodweb.ts [ticks] [seed] [json param overrides] [label]

import { DEFAULT_PARAMS, type SimParams } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

const ticks = Number(process.argv[2] ?? 216_000);
const seed = process.argv[3] ?? DEFAULT_PARAMS.seed;
if (!Number.isInteger(ticks) || ticks <= 0) throw new Error(`bad tick count ${process.argv[2]}`);

function parseOverrides(raw: string | undefined): Partial<SimParams> {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw) as Partial<SimParams>;
  } catch {
    throw new Error(`param overrides must be JSON, got: ${raw}`);
  }
}

const overrides = parseOverrides(process.argv[4]);
const label = process.argv[5] ?? 'run';

if (!Number.isInteger(ticks) || ticks <= 0) throw new Error(`bad tick count ${process.argv[2]}`);

const params: SimParams = { ...DEFAULT_PARAMS, seed, ...overrides };
const world = new World(params);
const minute = Math.round(60 / params.dt);

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function line(tick: number, ms: number): void {
  const radii = world.gene.radius.subarray(0, world.alive);
  const sorted = Float64Array.from(radii).sort((a, b) => a - b);
  let dwarf = 0;
  let mid = 0;
  let giant = 0;
  for (const r of sorted) {
    if (r < params.preyMinRadius) dwarf++;
    else if (r > 13) giant++;
    else mid++;
  }
  const r = world.report();
  const spread = percentile(sorted, 0.9) - percentile(sorted, 0.1);
  let bigParticles = 0;
  for (let i = 0; i < world.foodCount; i++) {
    if ((world.fr[i] ?? 0) >= params.bigFoodRadius) bigParticles++;
  }
  console.log(
    `${label} t=${tick} min=${(tick * params.dt / 60).toFixed(0)} pop=${world.alive} food=${world.foodCount} ` +
      `energy=${r.energy.toFixed(0)} r_p10=${percentile(sorted, 0.1).toFixed(1)} r_p50=${percentile(sorted, 0.5).toFixed(1)} ` +
      `r_p90=${percentile(sorted, 0.9).toFixed(1)} spread=${spread.toFixed(1)} ` +
      `dwarf(<${params.preyMinRadius})=${dwarf} mid=${mid} giant(>13)=${giant} ` +
      `meta=${r.means.metabolism.toFixed(3)} sense=${r.means.senseRadius.toFixed(0)} spd=${r.means.maxSpeed.toFixed(0)} `
      // the reservoir: uneaten large particles, i.e. the resource only the big morph can spend
      + `bigFood=${bigParticles}/${world.foodCount} ` +
      `${(ms / minute).toFixed(2)}ms/tick`,
  );
}

let block = 0;
for (let i = 0; i < ticks; i++) {
  world.step();
  if ((i + 1) % minute === 0) {
    const now = performance.now();
    line(i + 1, now - block);
    block = now;
  }
}
console.log(`${label} overrides: ${JSON.stringify(overrides)}`);
