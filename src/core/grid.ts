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

  /** Closest item within r that passes `accepts`, or -1. Ties resolve to the lower index. */
  nearest(
    x: number,
    y: number,
    r: number,
    getX: (item: number) => number,
    getY: (item: number) => number,
    accepts?: (item: number) => boolean,
  ): number {
    let best = -1;
    let bestD2 = r * r;
    this.visit(x, y, r, (item) => {
      if (accepts !== undefined && !accepts(item)) return;
      const dx = getX(item) - x;
      const dy = getY(item) - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = item;
      }
    });
    return best;
  }
}
