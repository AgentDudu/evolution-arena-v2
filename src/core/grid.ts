// Uniform spatial hash grid with intrusive linked-list buckets over fixed-capacity typed
// arrays: rebuild is O(items), query is O(cells). Rebuilt every tick.

import { clamp } from './space.ts';

export class UniformGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;

  constructor(width: number, height: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(Math.max(1, capacity)).fill(-1);
  }

  clear(): void {
    this.heads.fill(-1);
  }

  cellIndex(x: number, y: number): number {
    const cx = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  insert(item: number, x: number, y: number): void {
    const c = this.cellIndex(x, y);
    this.next[item] = this.heads[c] ?? -1;
    this.heads[c] = item;
  }

  /** Visit every item in the cells overlapping the circle (x, y, r). Exact distance filtering
   *  is the caller's job (or use nearest(), which filters). */
  visit(x: number, y: number, r: number, onItem: (item: number) => void): void {
    const cx0 = clamp(Math.floor((x - r) / this.cellSize), 0, this.cols - 1);
    const cx1 = clamp(Math.floor((x + r) / this.cellSize), 0, this.cols - 1);
    const cy0 = clamp(Math.floor((y - r) / this.cellSize), 0, this.rows - 1);
    const cy1 = clamp(Math.floor((y + r) / this.cellSize), 0, this.rows - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let item = this.heads[cy * this.cols + cx] ?? -1;
        while (item !== -1) {
          onItem(item);
          item = this.next[item] ?? -1;
        }
      }
    }
  }

  /** Closest item within r that passes `accepts`, or -1. Ties resolve to the lower index, and the
   *  walk visits cells and bucket entries in a fixed order so a query on identical world state
   *  always returns the same item.
   *
   *  Coordinates come in as the live arrays rather than accessor callbacks: at a full arena ~5 500
   *  queries run per tick, and the callback plumbing over ~70 000 candidates per tick was a third
   *  of the run's CPU. The sim's own hot path uses nearestSized() below; this stays general. */
  nearest(
    x: number,
    y: number,
    r: number,
    xs: Float64Array,
    ys: Float64Array,
    accepts?: (item: number) => boolean,
  ): number {
    let best = -1;
    let bestD2 = r * r;
    const cx0 = clamp(Math.floor((x - r) / this.cellSize), 0, this.cols - 1);
    const cx1 = clamp(Math.floor((x + r) / this.cellSize), 0, this.cols - 1);
    const cy0 = clamp(Math.floor((y - r) / this.cellSize), 0, this.rows - 1);
    const cy1 = clamp(Math.floor((y + r) / this.cellSize), 0, this.rows - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        let item = this.heads[row + cx] ?? -1;
        while (item !== -1) {
          if (accepts === undefined || accepts(item)) {
            const dx = (xs[item] ?? 0) - x;
            const dy = (ys[item] ?? 0) - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) {
              bestD2 = d2;
              best = item;
            }
          }
          item = this.next[item] ?? -1;
        }
      }
    }
    return best;
  }

  /** The same traversal and tie rule as nearest(), with the accept test written inline instead of
   *  called per candidate — that callback was 24% of a full-arena run, because 88% of queries end
   *  empty and every candidate still paid for the indirect call.
   *
   *  Accepts an item when all of these hold: `item !== exclude`; `flags` is null or flags[item]
   *  is 0; and its size passes `lo <= sizes[item]` and `sizes[item] * mul <= hi`. The three sim
   *  queries map onto it without changing one float comparison:
   *
   *    prey    sizes = gene.radius, lo = preyMinRadius, mul = predationRatio, hi = radius[hunter],
   *            flags = kill, exclude = hunter          (was the isPrey callback)
   *    threat  sizes = gene.radius, lo = radius[src] * predationRatio, mul = 1, hi = Infinity,
   *            exclude = src                          (was the isThreat callback)
   *    food    sizes = fr, lo = -Infinity, mul = 1, hi = foodGape   (was the isEdible callback)
   *
   *  The walk is deliberately duplicated from nearest() rather than shared: sharing it would cost
   *  a branch or a callback per candidate, which is exactly what this method exists to remove. */
  nearestSized(
    x: number,
    y: number,
    r: number,
    xs: Float64Array,
    ys: Float64Array,
    sizes: Float64Array,
    lo: number,
    mul: number,
    hi: number,
    exclude: number,
    flags: Uint8Array | null,
  ): number {
    let best = -1;
    let bestD2 = r * r;
    const cx0 = clamp(Math.floor((x - r) / this.cellSize), 0, this.cols - 1);
    const cx1 = clamp(Math.floor((x + r) / this.cellSize), 0, this.cols - 1);
    const cy0 = clamp(Math.floor((y - r) / this.cellSize), 0, this.rows - 1);
    const cy1 = clamp(Math.floor((y + r) / this.cellSize), 0, this.rows - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        let item = this.heads[row + cx] ?? -1;
        while (item !== -1) {
          if (item !== exclude) {
            const s = sizes[item] ?? 0;
            if (s >= lo && s * mul <= hi && (flags === null || (flags[item] ?? 0) === 0)) {
              const dx = (xs[item] ?? 0) - x;
              const dy = (ys[item] ?? 0) - y;
              const d2 = dx * dx + dy * dy;
              if (d2 <= bestD2) {
                bestD2 = d2;
                best = item;
              }
            }
          }
          item = this.next[item] ?? -1;
        }
      }
    }
    return best;
  }
}
