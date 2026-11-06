import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PARAMS,
  GENES,
  GENE_NAMES,
  mutateGene,
  randomGene,
  validateParams,
  type SimParams,
} from '../src/core/config.ts';
import { Rng } from '../src/core/rng.ts';
import { World } from '../src/sim/world.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('simulation hygiene', () => {
  it('core and sim contain no Math.random or wall-clock reads', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles('src/core'), ...sourceFiles('src/sim')]) {
      const text = readFileSync(file, 'utf8');
      if (/Math\.random\(|Date\.now\(|performance\.now\(|new Date\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('rejects a nonsensical param set', () => {
    expect(() => validateParams({ ...DEFAULT_PARAMS, configVersion: 99 })).toThrow(/configVersion/);
    expect(() => validateParams({ ...DEFAULT_PARAMS, foodCap: 1, foodFloor: 100 })).toThrow(/foodCap/);
    expect(() => validateParams({ ...DEFAULT_PARAMS, seed: '', worldWidth: 0 })).toThrow(/world size/);
    expect(() => validateParams(DEFAULT_PARAMS)).not.toThrow();
  });

  it('mutations always land inside the declared gene range', () => {
    const rng = new Rng('mutate');
    const p: SimParams = { ...DEFAULT_PARAMS, mutationRate: 1, mutationSigma: 0.4 };
    for (const name of GENE_NAMES) {
      const g = GENES[name];
      for (let i = 0; i < 2000; i++) {
        const v = mutateGene(rng, name, g.def, p);
        expect(v).toBeGreaterThanOrEqual(g.min);
        expect(v).toBeLessThanOrEqual(g.max);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('mutation is a no-op when mutationRate is 0', () => {
    const rng = new Rng('mutate-off');
    const p: SimParams = { ...DEFAULT_PARAMS, mutationRate: 0 };
    for (const name of GENE_NAMES) expect(mutateGene(rng, name, GENES[name].def, p)).toBe(GENES[name].def);
  });

  it('random genes stay in range', () => {
    const rng = new Rng('random-genes');
    for (const name of GENE_NAMES) {
      const g = GENES[name];
      for (let i = 0; i < 500; i++) {
        const v = randomGene(rng, name);
        expect(v).toBeGreaterThanOrEqual(g.min);
        expect(v).toBeLessThan(g.max);
      }
    }
  });
});

describe('per-tick invariants', () => {
  it('alive count, food count, energy, and positions stay inside their bounds', () => {
    const p: SimParams = { ...DEFAULT_PARAMS, seed: 'invariants', maxOrganisms: 400, foodCap: 500 };
    const w = new World(p);
    w.placeFood(10, 10);
    w.placeFood(1e9, -5); // painting outside the world is clamped, not wrapped
    for (let tick = 1; tick <= 900; tick++) {
      w.step();
      if (tick % 20 !== 0) continue; // full scan every 20th tick; expects are slow
      expect(w.alive).toBeLessThanOrEqual(p.maxOrganisms);
      expect(w.foodCount).toBeLessThanOrEqual(p.foodCap);
      for (let i = 0; i < w.alive; i++) {
        expect(w.energy[i]).toBeGreaterThan(0);
        expect(w.energy[i]).toBeLessThanOrEqual(w.gene.reproThreshold[i] * 2 + 1e-9);
        expect(w.x[i]).toBeGreaterThanOrEqual(0);
        expect(w.x[i]).toBeLessThanOrEqual(p.worldWidth);
        expect(w.y[i]).toBeGreaterThanOrEqual(0);
        expect(w.y[i]).toBeLessThanOrEqual(p.worldHeight);
        expect(Number.isFinite(w.vx[i]) && Number.isFinite(w.vy[i])).toBe(true);
        for (const name of GENE_NAMES) {
          const g = GENES[name];
          expect(w.gene[name][i]).toBeGreaterThanOrEqual(g.min);
          expect(w.gene[name][i]).toBeLessThanOrEqual(g.max);
        }
      }
    }
    expect(w.alive).toBeGreaterThan(0);
  });

  it('reproduction keeps a generation gap: a child cannot reproduce in its birth tick', () => {
    const p: SimParams = { ...DEFAULT_PARAMS, seed: 'child-gen', minAgeTicks: 0, foodPerTick: 40, foodCap: 2000 };
    const w = new World(p);
    const ticks = 300;
    for (let i = 0; i < ticks; i++) w.step();
    // With no age gate and dense food, reproduction can cascade, but never faster than one
    // generation per tick: a child acting in its birth tick would push past `ticks`.
    let maxGen = 0;
    for (let i = 0; i < w.alive; i++) maxGen = Math.max(maxGen, w.gen[i]);
    expect(maxGen).toBeGreaterThanOrEqual(2);
    expect(maxGen).toBeLessThanOrEqual(ticks);
  });

  it('an empty arena reseeds when reseedOnEmpty is set and stays empty when it is not', () => {
    const starving: SimParams = {
      ...DEFAULT_PARAMS,
      seed: 'starve',
      foodPerTick: 0,
      startFood: 0,
      foodFloor: 0,
      baseMeta: 500,
      minAgeTicks: 1_000_000,
    };
    const withReseed = new World(starving);
    const without = new World({ ...starving, reseedOnEmpty: false });
    for (let i = 0; i < 60; i++) {
      withReseed.step();
      without.step();
    }
    expect(without.alive).toBe(0);
    expect(withReseed.alive).toBeGreaterThan(0);
  });
});
