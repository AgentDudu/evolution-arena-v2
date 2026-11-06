import { describe, expect, it } from 'vitest';

import { Rng } from '../src/core/rng.ts';

function floatHash(rng: Rng, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) {
    const v = Math.trunc(rng.float() * 1e9);
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
  }
  return h >>> 0;
}

function draw(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.float());
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (xs: readonly number[]): number => xs.reduce((p, c) => p + c, 0) / xs.length;
  const sd = (xs: readonly number[]): number =>
    Math.sqrt(xs.reduce((p, c) => p + (c - mean(xs)) ** 2, 0) / xs.length);
  const acc = a.reduce((p, c, i) => p + (c - mean(a)) * (b[i] ?? 0 - mean(b)), 0);
  return acc / a.length / (sd(a) * sd(b));
}

describe('Rng', () => {
  it('replays an identical stream for the same seed', () => {
    expect(floatHash(new Rng('arena-1'), 1000)).toBe(floatHash(new Rng('arena-1'), 1000));
    expect(floatHash(new Rng(42), 1000)).toBe(floatHash(new Rng(42), 1000));
  });

  it('keeps the golden stream stable (a PRNG change is a world change)', () => {
    expect(floatHash(new Rng('arena-1'), 1000)).toBe(0x27f39617);
  });

  it('does not correlate near-identical seeds', () => {
    const a = draw(new Rng('arena-1'), 2000);
    const b = draw(new Rng('arena-2'), 2000);
    expect(Math.abs(correlation(a, b))).toBeLessThan(0.05);
    const c = draw(new Rng('1'), 2000);
    const d = draw(new Rng('2'), 2000);
    expect(Math.abs(correlation(c, d))).toBeLessThan(0.05);
  });

  it('is uniform enough for spawn placement', () => {
    const xs = draw(new Rng('uniform'), 20000);
    const mean = xs.reduce((p, c) => p + c, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('honours range, int, and pick', () => {
    const rng = new Rng('shapes');
    for (let i = 0; i < 500; i++) {
      const v = rng.range(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
      const n = rng.int(10);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    expect(() => new Rng('x').pick([])).toThrow(RangeError);
  });

  it('gaussian is deterministic and centred', () => {
    const a = new Rng('g1');
    const b = new Rng('g1');
    expect(a.gaussian(5, 2)).toBe(b.gaussian(5, 2));
    const rng = new Rng('g2');
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += rng.gaussian(0, 1);
    expect(Math.abs(sum / 20000)).toBeLessThan(0.05);
  });
});
