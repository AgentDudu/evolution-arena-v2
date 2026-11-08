import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, GENES, GENE_NAMES, mutateGene, type SimParams } from '../src/core/config.ts';
import { Rng } from '../src/core/rng.ts';
import { World } from '../src/sim/world.ts';

// The gene table is the contract every other layer reads: the editor's sliders, the renderer's radius,
// the mutation operator, and the share link's params. A gene whose declared range did not contain its
// own default would be an invisible clamp somewhere downstream.
//
// This file replaces a genetics test module that was written earlier in the work but never committed,
// so it was lost when the working tree was cleaned; the coverage is rebuilt from src/core/config.ts.

const ALL_GENES = GENE_NAMES;

function params(overrides: Partial<SimParams> = {}): SimParams {
  return { ...DEFAULT_PARAMS, ...overrides };
}

describe('gene table', () => {
  it('declares a usable range with the default inside it, for every gene', () => {
    for (const name of ALL_GENES) {
      const spec = GENES[name];
      expect(spec.min, `${name} min`).toBeLessThan(spec.max);
      expect(spec.def, `${name} default sits in range`).toBeGreaterThanOrEqual(spec.min);
      expect(spec.def, `${name} default sits in range`).toBeLessThanOrEqual(spec.max);
    }
  });

  it('lists each gene exactly once', () => {
    expect(new Set(ALL_GENES).size).toBe(ALL_GENES.length);
    expect(ALL_GENES.length).toBe(Object.keys(GENES).length);
  });
});

describe('mutateGene', () => {
  it('leaves a gene alone when the mutation rate is zero', () => {
    const rng = new Rng('no-mutation');
    const p = params({ mutationRate: 0, mutationSigma: 0.5 });
    for (const name of ALL_GENES) {
      const def = GENES[name].def;
      for (let draw = 0; draw < 50; draw++) {
        expect(mutateGene(rng, name, def, p)).toBe(def);
      }
    }
  });

  it('keeps every forced mutation inside the declared range', () => {
    // rate 1 with a sigma the size of the whole range: the gaussian lands far outside on purpose, and
    // the clamp is what stops an offspring genome from becoming something the world cannot render.
    const rng = new Rng('force-mutation');
    const p = params({ mutationRate: 1, mutationSigma: 1 });
    for (const name of ALL_GENES) {
      const { min, max } = GENES[name];
      let moved = 0;
      for (let draw = 0; draw < 400; draw++) {
        const out = mutateGene(rng, name, (min + max) / 2, p);
        expect(out, `${name} stayed in [${min}, ${max}]`).toBeGreaterThanOrEqual(min);
        expect(out, `${name} stayed in [${min}, ${max}]`).toBeLessThanOrEqual(max);
        expect(Number.isFinite(out), `${name} produced a finite value`).toBe(true);
        if (out !== (min + max) / 2) moved++;
      }
      expect(moved, `${name} actually mutated sometimes`).toBeGreaterThan(0);
    }
  });

  it('is a pure function of the seed: the same seed mutates the same way', () => {
    const p = params({ mutationRate: 1, mutationSigma: 0.2 });
    const sequence = (seed: string) => {
      const rng = new Rng(seed);
      return Array.from({ length: 200 }, () => mutateGene(rng, 'radius', 8, p));
    };
    expect(sequence('same-seed')).toEqual(sequence('same-seed'));
    expect(sequence('same-seed')).not.toEqual(sequence('other-seed'));
  });
});

describe('engineered genomes', () => {
  function arena(): World {
    const world = new World(
      params({ seed: 'clamp-genome', startFood: 1, startOrganisms: 1, foodPerTick: 0, foodFloor: 0, reseedOnEmpty: false }),
    );
    world.alive = 0;
    world.foodCount = 0;
    return world;
  }

  it('clamps a genome the genetics cannot express into the nearest value it can', () => {
    const world = arena();
    const slot = world.engineer(200, 200, {
      radius: 999, // over the biggest creature the world draws
      maxSpeed: -50, // and below the slowest
      hue: 720, // wraps past the colour wheel in the editor, must not here
      senseRadius: GENES.senseRadius.def,
    });
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(world.gene.radius[slot]).toBe(GENES.radius.max);
    expect(world.gene.maxSpeed[slot]).toBe(GENES.maxSpeed.min);
    expect(world.gene.hue[slot]).toBe(GENES.hue.max);
    expect(world.gene.senseRadius[slot]).toBe(GENES.senseRadius.def);
  });

  it('fills an omitted gene with the species default instead of zero', () => {
    const world = arena();
    const slot = world.engineer(200, 200, { radius: 10 });
    for (const name of ALL_GENES) {
      if (name === 'radius') continue;
      expect(world.gene[name][slot], `${name} fell back to its default`).toBe(GENES[name].def);
    }
  });

  it('keeps one value per organism for every gene array', () => {
    const world = arena();
    const first = world.engineer(120, 120, { radius: 6 });
    const second = world.engineer(180, 180, { radius: 14 });
    const lengths = new Set(ALL_GENES.map((name) => world.gene[name].length));
    expect(lengths.size, 'every gene array is the same width').toBe(1);
    expect(world.gene.radius[first]).toBe(6);
    expect(world.gene.radius[second]).toBe(14);
    expect(world.alive).toBe(2);
  });
});
