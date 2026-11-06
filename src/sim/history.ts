// Metric history feeding the graph panels (PLAN §14 item 6). Fixed capacity that downsamples when
// full, so an hour of turbo cannot grow the heap: samples are columns of Float64Array, never arrays
// of objects.

import type { WorldReport } from './world.ts';

export const METRIC_COLUMNS = [
  'pop',
  'food',
  'energy',
  'generations',
  'species',
  'radius',
  'senseRadius',
  'maxSpeed',
  'metabolism',
] as const;

export type MetricColumn = (typeof METRIC_COLUMNS)[number];

export class MetricsHistory {
  readonly capacity: number;
  /** Ticks between samples. Doubles each time the buffer fills, so coverage grows with the run. */
  stride: number;
  length = 0;
  lastTick = -Infinity;

  /** x axis: the tick each sample was taken at. */
  readonly tick: Float64Array;
  /** One column per metric, indexed the same way as `tick`. */
  readonly series: Record<MetricColumn, Float64Array>;

  private readonly initialStride: number;

  constructor(capacity = 1024, stride = 15) {
    if (!(capacity >= 2)) throw new Error(`MetricsHistory capacity must be >= 2, got ${capacity}`);
    if (!(stride >= 1)) throw new Error(`MetricsHistory stride must be >= 1, got ${stride}`);
    this.capacity = capacity;
    this.initialStride = stride;
    this.stride = stride;
    this.tick = new Float64Array(capacity);
    this.series = Object.fromEntries(METRIC_COLUMNS.map((name) => [name, new Float64Array(capacity)])) as Record<
      MetricColumn,
      Float64Array
    >;
  }

  /** Take the report if enough ticks passed. Returns true when a sample was written. */
  sample(report: WorldReport): boolean {
    if (report.tick - this.lastTick < this.stride) return false;
    if (this.length === this.capacity) this.downsample();
    const i = this.length++;
    this.tick[i] = report.tick;
    this.series.pop[i] = report.organisms;
    this.series.food[i] = report.food;
    this.series.energy[i] = report.energy;
    this.series.generations[i] = report.meanGeneration;
    this.series.species[i] = report.speciesCount;
    this.series.radius[i] = report.means.radius;
    this.series.senseRadius[i] = report.means.senseRadius;
    this.series.maxSpeed[i] = report.means.maxSpeed;
    this.series.metabolism[i] = report.means.metabolism;
    this.lastTick = report.tick;
    return true;
  }

  /** Halve the history: every second sample, first and last always kept. */
  private downsample(): void {
    const columns: Float64Array[] = [this.tick, ...METRIC_COLUMNS.map((name) => this.series[name])];
    const last = this.length - 1;
    let w = 0;
    for (let r = 0; r < this.length; r += 2) {
      for (const c of columns) c[w] = c[r];
      w++;
    }
    if (last % 2 !== 0) {
      for (const c of columns) c[w] = c[last];
      w++;
    }
    this.length = w;
    this.stride *= 2;
  }

  reset(): void {
    this.length = 0;
    this.lastTick = -Infinity;
    this.stride = this.initialStride;
  }

  /**
   * uPlot data shape: [ticks, ...one column per requested metric]. These are views into the
   * columns, not copies: uPlot accepts typed arrays, so a 4 Hz graph refresh creates no garbage at
   * all, which is what keeps the soak heap flat. A downsample rewrites the buffer in place, so the
   * views uPlot still holds may show a half-compacted frame for one animation frame — cosmetic.
   */
  uPlotData(names: MetricColumn[]): Float64Array[] {
    const view = (column: Float64Array): Float64Array => column.subarray(0, this.length);
    return [view(this.tick), ...names.map((name) => view(this.series[name]))];
  }
}
