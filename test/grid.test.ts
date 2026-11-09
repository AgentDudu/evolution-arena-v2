import { describe, expect, it } from 'vitest';

import { UniformGrid } from '../src/core/grid.ts';
import { Rng } from '../src/core/rng.ts';

const W = 1000;
const H = 600;
const N = 300;

function makePoints(rng: Rng): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = rng.range(0, W);
    y[i] = rng.range(0, H);
  }
  return { x, y };
}

function bruteNearest(
  x: Float64Array,
  y: Float64Array,
  qx: number,
  qy: number,
  r: number,
  accepts?: (i: number) => boolean,
): number {
  let best = -1;
  let bestD2 = r * r;
  for (let i = 0; i < N; i++) {
    if (accepts !== undefined && !accepts(i)) continue;
    const dx = (x[i] ?? 0) - qx;
    const dy = (y[i] ?? 0) - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

describe('UniformGrid', () => {
  it('finds the same nearest point as a brute-force scan', () => {
    const rng = new Rng('grid');
    const { x, y } = makePoints(rng);
    for (const cellSize of [16, 64, 200]) {
      const grid = new UniformGrid(W, H, cellSize, N);
      for (let i = 0; i < N; i++) grid.insert(i, x[i] ?? 0, y[i] ?? 0);
      for (let q = 0; q < 100; q++) {
        const qx = rng.range(0, W);
        const qy = rng.range(0, H);
        const r = rng.range(5, 250);
        const got = grid.nearest(qx, qy, r, x, y);
        const want = bruteNearest(x, y, qx, qy, r);
        if (want === -1) {
          expect(got).toBe(-1);
        } else {
          expect(got).not.toBe(-1);
          const gotD = Math.hypot((x[got] ?? 0) - qx, (y[got] ?? 0) - qy);
          const wantD = Math.hypot((x[want] ?? 0) - qx, (y[want] ?? 0) - qy);
          expect(gotD).toBeCloseTo(wantD, 9);
        }
      }
    }
  });

  it('respects the accepts filter', () => {
    const rng = new Rng('grid-filter');
    const { x, y } = makePoints(rng);
    const grid = new UniformGrid(W, H, 50, N);
    for (let i = 0; i < N; i++) grid.insert(i, x[i] ?? 0, y[i] ?? 0);
    const evenOnly = (i: number): boolean => i % 7 === 0;
    for (let q = 0; q < 50; q++) {
      const qx = rng.range(0, W);
      const qy = rng.range(0, H);
      const got = grid.nearest(qx, qy, 120, x, y, evenOnly);
      const want = bruteNearest(x, y, qx, qy, 120, evenOnly);
      if (want === -1) expect(got).toBe(-1);
      else expect(got).toBe(want);
    }
  });

  it('visit() covers every point inside the query circle', () => {
    const rng = new Rng('grid-visit');
    const { x, y } = makePoints(rng);
    const grid = new UniformGrid(W, H, 50, N);
    for (let i = 0; i < N; i++) grid.insert(i, x[i] ?? 0, y[i] ?? 0);
    for (let q = 0; q < 30; q++) {
      const qx = rng.range(0, W);
      const qy = rng.range(0, H);
      const r = rng.range(10, 200);
      const seen = new Set<number>();
      grid.visit(qx, qy, r, (i) => void seen.add(i));
      for (let i = 0; i < N; i++) {
        const inside = Math.hypot((x[i] ?? 0) - qx, (y[i] ?? 0) - qy) <= r;
        if (inside) expect(seen.has(i)).toBe(true);
      }
    }
  });

  it('clear() empties the buckets', () => {
    const rng = new Rng('grid-clear');
    const { x, y } = makePoints(rng);
    const grid = new UniformGrid(W, H, 50, N);
    for (let i = 0; i < N; i++) grid.insert(i, x[i] ?? 0, y[i] ?? 0);
    grid.clear();
    for (let q = 0; q < 20; q++) {
      expect(grid.nearest(rng.range(0, W), rng.range(0, H), 500, x, y)).toBe(-1);
    }
  });

  /** nearestSized() exists only to drop the per-candidate callback from the sim's queries, so it has
   *  to return the *same index* nearest() returns, not merely an equally close item — a different
   *  winner would drift the whole world. The bounds are the shape the three sim rules use. */
  it('nearestSized() answers with the same index as nearest() plus the equivalent predicate', () => {
    const rng = new Rng('grid-sized');
    const { x, y } = makePoints(rng);
    const sizes = new Float64Array(N);
    const flags = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      sizes[i] = 2 + (i % 9);
      if (i % 5 === 0) flags[i] = 1;
    }
    for (const cellSize of [16, 64, 200]) {
      const grid = new UniformGrid(W, H, cellSize, N);
      for (let i = 0; i < N; i++) grid.insert(i, x[i] ?? 0, y[i] ?? 0);
      for (const withFlags of [true, false]) {
        for (let q = 0; q < 80; q++) {
          const qx = rng.range(0, W);
          const qy = rng.range(0, H);
          const r = rng.range(5, 250);
          const lo = rng.range(3, 8);
          const mul = rng.range(1, 2.5);
          const hi = rng.range(4, 16);
          const exclude = withFlags ? Math.floor(rng.range(0, N)) : -1;
          const accepts = (i: number): boolean =>
            i !== exclude &&
            (!withFlags || (flags[i] ?? 0) === 0) &&
            (sizes[i] ?? 0) >= lo &&
            (sizes[i] ?? 0) * mul <= hi;
          const want = grid.nearest(qx, qy, r, x, y, accepts);
          const got = grid.nearestSized(qx, qy, r, x, y, sizes, lo, mul, hi, exclude, withFlags ? flags : null);
          expect(got).toBe(want);
        }
      }
    }
  });
});
