import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, type GeneName } from '../src/core/config.ts';
import { World } from '../src/sim/world.ts';

// Work item 5 done-when: "an engineered lineage placed mid-run visibly competes with the wild
// population". test/sandbox.test.ts proves the tool reaches the world; this proves the released line
// establishes - survives, breeds, and keeps its designed trait - inside a food web that is already at
// carrying capacity, and that a bad genome fails. Both halves matter: a test that only shows success
// would not tell a released creature apart from noise.

const SETTLE = 12_000; // 3.5 sim-minutes for the wild world to reach its standing size structure
const AFTER = 12_000; // 3.5 sim-minutes for the released lineage to establish
const SAMPLE_EVERY = 600;
const FOUNDERS = 12;
const GRACE = 1_200; // founders are fresh meat; establishment is judged after they have had a chance

/** A genome built from the population's own current means with one trait changed. This is what the
 *  page's "copy wild mean" button does, and it is the only way a release can be read as an experiment
 *  rather than as a creature the arena was never going to accept. */
function wildMeanGenome(world: World, override: Partial<Record<GeneName, number>>): Partial<Record<GeneName, number>> {
  const m = world.report().means;
  return {
    maxSpeed: m.maxSpeed,
    senseRadius: m.senseRadius,
    metabolism: m.metabolism,
    reproThreshold: m.reproThreshold,
    seekFood: m.seekFood,
    flee: m.flee,
    wander: m.wander,
    hue: 300, // marker hue so the released line is legible against the wild palette
    ...override,
  };
}

function split(world: World): { eng: number; share: number; engRadius: number; engMaxGen: number; wild: number } {
  let eng = 0;
  let engRadius = 0;
  let engMaxGen = 0;
  let wild = 0;
  for (let i = 0; i < world.alive; i++) {
    if (world.origin[i] === 1) {
      eng++;
      engRadius += world.gene.radius[i];
      if (world.gen[i] > engMaxGen) engMaxGen = world.gen[i];
    } else {
      wild++;
    }
  }
  return {
    eng,
    share: world.alive > 0 ? eng / world.alive : 0,
    engRadius: eng > 0 ? engRadius / eng : 0,
    engMaxGen,
    wild,
  };
}

describe('engineered lineage released mid-run', () => {
  const cases: { name: string; seed: string; radius: number }[] = [
    // a large-particle specialist where large particles stock up (57 of them at release)
    { name: 'giant on release-mid', seed: 'release-mid', radius: 15.5 },
    // a small-class generalist in a dwarf-led world
    { name: 'dwarf on arena-1', seed: 'arena-1', radius: 5 },
  ];

  it.each(cases)('%s establishes and keeps its designed size', async ({ seed, radius }) => {
    const world = new World({ ...DEFAULT_PARAMS, seed, reseedOnEmpty: false });
    while (world.tick < SETTLE) await step(world, 1000);

    const genes = wildMeanGenome(world, { radius });
    for (let k = 0; k < FOUNDERS; k++) {
      world.engineer(
        world.params.worldWidth / 2 + world.rng.range(-20, 20),
        world.params.worldHeight / 2 + world.rng.range(-20, 20),
        genes,
      );
    }

    const samples: { tick: number; eng: number; share: number; engRadius: number; engMaxGen: number; wild: number }[] = [];
    const end = world.tick + AFTER;
    while (world.tick < end) {
      await step(world, SAMPLE_EVERY);
      const s = split(world);
      samples.push({ tick: world.tick, eng: s.eng, share: s.share, engRadius: s.engRadius, engMaxGen: s.engMaxGen, wild: s.wild });
    }

    const judged = samples.filter((s) => s.tick >= SETTLE + GRACE);
    const counts = judged.map((s) => s.eng);
    const minCount = Math.min(...counts);
    const peakCount = Math.max(...counts);
    const lastCount = counts[counts.length - 1];
    const radii = judged.map((s) => s.engRadius);
    const last = samples[samples.length - 1];
    console.log(
      `release ${seed} r=${radius}: ` +
        judged.map((s) => `${s.tick - SETTLE}:${s.eng}`).join(' ') +
        ` | radius ${Math.min(...radii).toFixed(2)}-${Math.max(...radii).toFixed(2)} (designed ${radius})` +
        ` | maxGen ${Math.max(...judged.map((s) => s.engMaxGen))} | wild ${last.wild}`,
    );

    // Establishment, measured on the two seeds above (giant 4->19->6 over 20 min, dwarf 15->17):
    // the lineage is never wiped out, it grows past the number of founders released, and descendants
    // are still present at the end. A lineage that merely lingers would not pass the middle bar.
    expect(minCount).toBeGreaterThanOrEqual(1);
    expect(peakCount).toBeGreaterThanOrEqual(FOUNDERS);
    expect(lastCount).toBeGreaterThanOrEqual(3);
    // it bred: descendants carry the origin marker, not just the 12 founders
    expect(Math.max(...judged.map((s) => s.engMaxGen))).toBeGreaterThanOrEqual(1);
    // the designed trait is heritable and stayed recognisable rather than swarmed by the wild mean
    expect(Math.min(...radii)).toBeGreaterThan(radius - 1.5);
    expect(Math.max(...radii)).toBeLessThan(radius + 1.5);
    // and the wild population was not displaced
    expect(last.wild).toBeGreaterThan(500);
  }, 300_000);

  // The negative control: the same release with a genome the arena does not accept. senseRadius 150
  // costs 0.0008 * 150^2 = 18 energy per tick against the ~1.7 the population settled on, and the
  // mid size handles neither food class well. Measured: all 12 founders gone within 100 ticks.
  it('does not rescue a genome the arena rejects', async () => {
    const world = new World({ ...DEFAULT_PARAMS, seed: 'release-mid', reseedOnEmpty: false });
    while (world.tick < SETTLE) await step(world, 1000);
    for (let k = 0; k < 12; k++) {
      world.engineer(world.params.worldWidth / 2 + world.rng.range(-20, 20), world.params.worldHeight / 2 + world.rng.range(-20, 20), {
        radius: 10,
        maxSpeed: 105,
        senseRadius: 150,
        metabolism: 0.7,
        reproThreshold: 170,
        seekFood: 0.9,
        flee: 0.6,
        wander: 0.25,
        hue: 300,
      });
    }
    let aliveSamples = 0;
    const end = world.tick + AFTER;
    while (world.tick < end) {
      await step(world, SAMPLE_EVERY);
      if (split(world).eng > 0) aliveSamples++;
    }
    expect(split(world).eng).toBe(0);
    expect(aliveSamples / (AFTER / SAMPLE_EVERY)).toBeLessThan(0.25);
  }, 300_000);
});

async function step(world: World, ticks: number): Promise<void> {
  const stop = Math.min(world.tick + ticks, SETTLE + AFTER + 1);
  while (world.tick < stop) world.step();
  await new Promise((resolve) => setImmediate(resolve));
}
