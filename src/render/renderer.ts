// Canvas 2D aerial renderer (PLAN §6). Batches entities by palette key so a fill happens per
// bucket, not per organism. Positions are interpolated between prevX/prevY and x/y.

import type { World } from '../sim/world.ts';
import { type Camera, toPixelX, toPixelY } from './camera.ts';
import { ENERGY_BANDS, HUE_BUCKETS, PALETTE, paletteKey } from './palette.ts';

export interface DrawOptions {
  alpha: number;
  selected: number;
  /** Keep this lineage at full colour and dim the rest; -1 leaves everything normal. */
  isolateLineage: number;
  /** Recent positions of the tracked organism as x,y pairs (aerial view has no camera follow). */
  trail: Float64Array | null;
  trailLength: number;
}

const BACKGROUND = '#0b0f14';
const ARENA_EDGE = '#2a3644';
const FOOD_COLOR = '#5fd08a';
const BIG_FOOD_COLOR = '#c8e66a';
const DIM_ORGANISM = '#1d2530';

export class Renderer {
  private readonly buckets: number[][] = Array.from({ length: HUE_BUCKETS * ENERGY_BANDS }, () => []);
  private readonly dim: number[] = [];
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** Match the backing store to the element size at this device pixel ratio. */
  resize(): { pixelWidth: number; pixelHeight: number; dpr: number } {
    const dpr = Math.min(2, this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    return { pixelWidth, pixelHeight, dpr };
  }

  draw(world: World, camera: Camera, opts: DrawOptions): void {
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    const p = world.params;

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // two passes, one per particle class: the large class is the giants' exclusive resource, so it
    // has to be visible as its own thing (and fillStyle per particle would cost 1500 style changes)
    ctx.fillStyle = FOOD_COLOR;
    ctx.beginPath();
    for (let i = 0; i < world.foodCount; i++) {
      if ((world.fr[i] ?? p.foodRadius) >= p.bigFoodRadius) continue;
      const size = Math.max(1, (world.fr[i] ?? p.foodRadius) * 2 * camera.scale);
      ctx.rect(toPixelX(camera, world.fx[i]) - size / 2, toPixelY(camera, world.fy[i]) - size / 2, size, size);
    }
    ctx.fill();

    ctx.fillStyle = BIG_FOOD_COLOR;
    ctx.beginPath();
    for (let i = 0; i < world.foodCount; i++) {
      if ((world.fr[i] ?? p.foodRadius) < p.bigFoodRadius) continue;
      const size = Math.max(1, (world.fr[i] ?? p.foodRadius) * 2 * camera.scale);
      ctx.rect(toPixelX(camera, world.fx[i]) - size / 2, toPixelY(camera, world.fy[i]) - size / 2, size, size);
    }
    ctx.fill();

    for (const bucket of this.buckets) bucket.length = 0;
    this.dim.length = 0;
    const isolate = opts.isolateLineage >= 0;
    for (let i = 0; i < world.alive; i++) {
      if (isolate && world.lineage[i] !== opts.isolateLineage) {
        this.dim.push(i);
        continue;
      }
      const fraction = world.energy[i] / (world.gene.reproThreshold[i] * 2);
      this.buckets[paletteKey(world.gene.hue[i], fraction)]?.push(i);
    }

    if (this.dim.length > 0) {
      ctx.fillStyle = DIM_ORGANISM;
      ctx.beginPath();
      for (const i of this.dim) {
        const x = toPixelX(camera, world.prevX[i] + (world.x[i] - world.prevX[i]) * opts.alpha);
        const y = toPixelY(camera, world.prevY[i] + (world.y[i] - world.prevY[i]) * opts.alpha);
        const r = Math.max(0.8, world.gene.radius[i] * camera.scale);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    for (let key = 0; key < this.buckets.length; key++) {
      const indices = this.buckets[key];
      if (indices === undefined || indices.length === 0) continue;
      ctx.fillStyle = PALETTE[key] ?? '#888888';
      ctx.beginPath();
      for (const i of indices) {
        const x = toPixelX(camera, world.prevX[i] + (world.x[i] - world.prevX[i]) * opts.alpha);
        const y = toPixelY(camera, world.prevY[i] + (world.y[i] - world.prevY[i]) * opts.alpha);
        const r = Math.max(0.8, world.gene.radius[i] * camera.scale);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (opts.trail !== null && opts.trailLength > 1) {
      ctx.strokeStyle = 'rgba(232, 238, 246, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < opts.trailLength; i++) {
        const x = toPixelX(camera, opts.trail[i * 2]);
        const y = toPixelY(camera, opts.trail[i * 2 + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (opts.selected >= 0 && opts.selected < world.alive) {
      const i = opts.selected;
      const x = toPixelX(camera, world.x[i]);
      const y = toPixelY(camera, world.y[i]);
      ctx.strokeStyle = '#e8eef6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, world.gene.senseRadius[i] * camera.scale), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = ARENA_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(camera.offsetX, camera.offsetY, camera.drawnWidth, camera.drawnHeight);
  }
}
