// Every tunable lives here so the simulation reads one validated object per tick and a run is
// fully described by (seed, params). Ranges come from docs/PLAN.md section 5.

import { clamp } from './space.ts';
import type { Seed } from './rng.ts';

export const CONFIG_VERSION = 1;

export type WallMode = 'bounce' | 'wrap';

export interface GeneSpec {
  readonly min: number;
  readonly max: number;
  readonly def: number;
}

export const GENES = {
  radius: { min: 4, max: 16, def: 8 },
  maxSpeed: { min: 25, max: 120, def: 60 },
  senseRadius: { min: 20, max: 200, def: 80 },
  metabolism: { min: 0.6, max: 1.6, def: 1 },
  reproThreshold: { min: 120, max: 400, def: 220 },
  seekFood: { min: 0, max: 1, def: 0.8 },
  flee: { min: 0, max: 1, def: 0.2 },
  wander: { min: 0, max: 1, def: 0.3 },
  hue: { min: 0, max: 360, def: 180 },
} satisfies Record<string, GeneSpec>;

export type GeneName = keyof typeof GENES;
export const GENE_NAMES = Object.keys(GENES) as GeneName[];

export interface SimParams {
  configVersion: number;
  seed: Seed;

  worldWidth: number;
  worldHeight: number;
  wallMode: WallMode;

  startOrganisms: number;
  startFood: number;
  maxOrganisms: number;
  foodCap: number;
  foodFloor: number;
  foodPerTick: number;
  foodEnergy: number;
  foodRadius: number;

  dt: number;
  accel: number;

  baseMeta: number;
  metaK: number;
  metaExp: number;
  moveK: number;
  senseCostK: number;
  speedPenalty: number;
  wanderStrength: number;

  minAgeTicks: number;
  reproShareParent: number;
  reproShareChild: number;
  mutationRate: number;
  mutationSigma: number;

  predationEnabled: boolean;
  predationRatio: number;
  preyMinRadius: number;
  preyEnergyFraction: number;

  reseedOnEmpty: boolean;
  metricEvery: number;
}

export const DEFAULT_PARAMS: SimParams = {
  configVersion: CONFIG_VERSION,
  seed: 'arena-1',

  worldWidth: 1600,
  worldHeight: 900,
  wallMode: 'bounce',

  startOrganisms: 100,
  startFood: 900,
  maxOrganisms: 2000,
  foodCap: 1500,
  foodFloor: 60,
  foodPerTick: 10,
  foodEnergy: 25,
  foodRadius: 3,

  dt: 1 / 60,
  accel: 4,

  baseMeta: 1.5,
  metaK: 0.25,
  metaExp: 0.75,
  moveK: 0.00015,
  senseCostK: 0.0008,
  speedPenalty: 0.04,
  wanderStrength: 120,

  minAgeTicks: 180,
  reproShareParent: 0.5,
  reproShareChild: 0.8,
  mutationRate: 0.15,
  mutationSigma: 0.05,

  predationEnabled: false,
  predationRatio: 1.25,
  preyMinRadius: 6,
  preyEnergyFraction: 0.5,

  reseedOnEmpty: true,
  metricEvery: 15,
};

/** Cheap sanity gate: a nonsensical param set should fail loudly at load, not silently drift. */
export function validateParams(p: SimParams): void {
  const problems: string[] = [];
  if (p.configVersion !== CONFIG_VERSION) problems.push(`configVersion ${p.configVersion} != ${CONFIG_VERSION}`);
  if (!(p.worldWidth > 0) || !(p.worldHeight > 0)) problems.push('world size must be positive');
  if (p.wallMode !== 'bounce' && p.wallMode !== 'wrap') problems.push(`unknown wallMode ${String(p.wallMode)}`);
  if (p.foodCap < p.foodFloor) problems.push('foodCap < foodFloor');
  if (p.foodPerTick < 0) problems.push('foodPerTick must be >= 0');
  if (p.foodEnergy <= 0) problems.push('foodEnergy must be positive');
  if (!(p.maxOrganisms >= 10)) problems.push('maxOrganisms must be >= 10');
  if (p.startOrganisms < 1 || p.startOrganisms > p.maxOrganisms) problems.push('startOrganisms out of range');
  if (!(p.dt > 0)) problems.push('dt must be positive');
  for (const name of GENE_NAMES) {
    const g = GENES[name];
    if (!(g.min < g.max)) problems.push(`gene ${name} has min >= max`);
    if (g.def < g.min || g.def > g.max) problems.push(`gene ${name} default out of range`);
  }
  if (p.mutationRate < 0 || p.mutationRate > 1) problems.push('mutationRate must be in [0,1]');
  if (p.reproShareParent <= 0 || p.reproShareParent > 1) problems.push('reproShareParent must be in (0,1]');
  if (problems.length > 0) throw new Error(`invalid SimParams:\n  ${problems.join('\n  ')}`);
}

export function randomGene(rng: { float(): number }, name: GeneName): number {
  const g = GENES[name];
  return g.min + (g.max - g.min) * rng.float();
}

export function mutateGene(rng: { float(): number; gaussian(mean: number, sigma: number): number }, name: GeneName, value: number, p: SimParams): number {
  const g = GENES[name];
  let out = value;
  if (rng.float() < p.mutationRate) out = rng.gaussian(value, (g.max - g.min) * p.mutationSigma);
  return clamp(out, g.min, g.max);
}
