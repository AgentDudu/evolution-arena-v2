// Seeded PRNG. One stream drives every random decision in the sim so a run is reproducible
// from a seed alone (docs/PLAN.md section 4). Never use Math.random or Date.now in sim code.

export type Seed = string | number;

export function hashSeed(seed: Seed): number {
  let h = 0x811c9dc5;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: Seed) {
    // splitmix32 fills the four state words: seeding sfc32 straight from a small integer or a
    // near-identical string leaves the streams correlated, so "arena-1" and "arena-2" would be
    // almost the same world.
    let z = hashSeed(seed);
    const splitmix = (): number => {
      z = (z + 0x9e3779b9) | 0;
      let t = z ^ (z >>> 15);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.a = splitmix();
    this.b = splitmix();
    this.c = splitmix();
    this.d = splitmix();
    for (let i = 0; i < 12; i++) this.next();
  }

  /** sfc32 step: uint32 in [0, 2^32). */
  next(): number {
    const t = (this.a + this.b) | 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.d = (this.d + 1) | 0;
    const s = (t + this.d) | 0;
    this.c = (this.c + s) | 0;
    return s >>> 0;
  }

  float(): number {
    return this.next() / 0x100000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return this.next() % maxExclusive;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new RangeError('pick from empty list');
    return item;
  }

  /** Box-Muller; used for mutation noise and wander jitter. */
  gaussian(mean: number, sigma: number): number {
    const u = Math.max(this.float(), Number.MIN_VALUE);
    const v = this.float();
    return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
