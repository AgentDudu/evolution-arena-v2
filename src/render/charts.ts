// Graph panels (uPlot) plus the live size histogram for the graphs column — PLAN §14 item 6.
// DOM only: every number comes from MetricsHistory, and that buffer is what test/metrics.test.ts
// proves stays bounded, which is the "no heap growth over an hour of turbo" half of the done-when.

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { GENES, type GeneName } from '../core/config.ts';
import type { MetricsHistory, MetricColumn } from '../sim/history.ts';
import type { SpeciesClass } from '../sim/world.ts';

const DIM = '#8c9cb0';
const GRID = '#22303f';

interface PanelSpec {
  id: string;
  title: string;
  columns: MetricColumn[];
  colors: string[];
  /** Plot each gene mean as its share of that gene's range so four scales fit one axis. */
  normalized?: boolean;
}

const SPECS: PanelSpec[] = [
  { id: 'chart-pop', title: 'population / food', columns: ['pop', 'food', 'engineered'], colors: ['#7fd3ff', '#5fd08a', '#ffe36b'] },
  { id: 'chart-energy', title: 'total energy', columns: ['energy'], colors: ['#f4c26b'] },
  {
    id: 'chart-traits',
    title: 'trait means · share of gene range',
    columns: ['radius', 'maxSpeed', 'senseRadius', 'metabolism'],
    colors: ['#ff8f6b', '#7fd3ff', '#5fd08a', '#f4c26b'],
    normalized: true,
  },
  { id: 'chart-species', title: 'size classes called species', columns: ['species'], colors: ['#c58cff'] },
];

export class Charts {
  private readonly plots: { plot: uPlot; spec: PanelSpec; scratch: Float64Array[] }[] = [];
  private readonly histogram: HTMLCanvasElement | null;

  constructor(mounts: Record<string, HTMLElement>, histogram: HTMLCanvasElement | null, width = 300, height = 96) {
    for (const spec of SPECS) {
      const mount = mounts[spec.id];
      if (mount === undefined) continue;
      const plot = new uPlot(
        {
          width,
          height,
          scales: spec.normalized ? { x: { time: false }, y: { min: 0, max: 1 } } : { x: { time: false } },
          series: [{ label: 'tick' }, ...spec.columns.map((name, i) => ({ label: name, stroke: spec.colors[i], width: 1.5 }))],
          axes: [
            { stroke: DIM, grid: { stroke: GRID }, font: '10px ui-monospace, monospace', label: '' },
            { stroke: DIM, grid: { stroke: GRID }, font: '10px ui-monospace, monospace', label: '' },
          ],
          legend: { show: spec.columns.length > 1, live: false },
          cursor: { points: { show: false } },
        },
        [[], []],
      );
      mount.appendChild(plot.root);
      this.plots.push({ plot, spec, scratch: [] });
    }
    this.histogram = histogram;
  }

  update(history: MetricsHistory): void {
    for (const entry of this.plots) {
      const [ticks, ...values] = history.uPlotData(entry.spec.columns);
      const columns: Float64Array[] = [ticks];
      for (let c = 0; c < values.length; c++) {
        const column = values[c];
        if (entry.spec.normalized !== true) {
          columns.push(column);
          continue;
        }
        // the only place a share-of-range transform is needed, done into a buffer that is reused
        let buffer = entry.scratch[c];
        if (buffer === undefined || buffer.length < column.length) buffer = entry.scratch[c] = new Float64Array(column.length);
        const gene = GENES[entry.spec.columns[c] as GeneName];
        const span = gene.max - gene.min;
        for (let i = 0; i < column.length; i++) buffer[i] = (column[i] - gene.min) / span;
        columns.push(buffer.subarray(0, column.length));
      }
      entry.plot.setData(columns);
    }
  }

  /** Bars of the current radius distribution — the fastest way to see two size morphs apart. */
  drawHistogram(bins: SpeciesClass[]): void {
    const canvas = this.histogram;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = Math.min(2, canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (bins.length === 0) return;

    let peak = 0;
    for (const bin of bins) peak = Math.max(peak, bin.count);
    const barWidth = width / bins.length;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i]!;
      const h = peak > 0 ? (bin.count / peak) * (height - 10 * dpr) : 0;
      ctx.fillStyle = `hsl(${bin.hue} 60% 55%)`;
      ctx.fillRect(i * barWidth + dpr, height - h, barWidth - 2 * dpr, h);
    }
    ctx.fillStyle = DIM;
    ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    const first = bins[0]!;
    const last = bins[bins.length - 1]!;
    ctx.fillText(`r ${first.radius.toFixed(0)}–${last.radius.toFixed(0)} · peak ${peak}`, 2 * dpr, 10 * dpr);
  }

  destroy(): void {
    for (const { plot } of this.plots) plot.destroy();
    this.plots.length = 0;
  }
}
