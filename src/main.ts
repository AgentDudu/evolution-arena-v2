// Browser entry: world + fixed-step loop + aerial renderer + graphs + organism inspector + the
// controls needed to watch evolution happen. Sandbox depth (trait editor, events, edit log) is the
// next work item.

import { Charts } from './render/charts.ts';
import { MetricsHistory } from './sim/history.ts';

import { DEFAULT_PARAMS, GENES, GENE_NAMES, nextSpeed, type SimParams } from './core/config.ts';
import { cssToDevice, fitCamera, toWorldX, toWorldY, type Camera } from './render/camera.ts';
import { Renderer } from './render/renderer.ts';
import { advance, createClock, runTimeBoxed } from './sim/loop.ts';
import { World } from './sim/world.ts';

const canvas = document.getElementById('arena') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const inspector = document.getElementById('inspector') as HTMLElement;
const isolateBox = document.getElementById('isolate') as HTMLInputElement;
const histogram = document.getElementById('histogram') as HTMLCanvasElement | null;
const seedInput = document.getElementById('seed') as HTMLInputElement;
const playPause = document.getElementById('playpause') as HTMLButtonElement;
const stepButton = document.getElementById('step') as HTMLButtonElement;
const turboButton = document.getElementById('turbo') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-speed]')];

const urlSeed = new URLSearchParams(location.search).get('seed');
const params: SimParams = { ...DEFAULT_PARAMS, seed: urlSeed ?? DEFAULT_PARAMS.seed };
seedInput.value = String(params.seed);

let world = new World(params);
let clock = createClock();
let camera: Camera = fitCamera(params.worldWidth, params.worldHeight, 1, 1);
let dpr = 1;

let speed = 1;
let paused = false;
let turbo = false;
let isolate = false;
// Slots move when the population array compacts, so the tracked organism is a lineage id and its
// slot is looked up again each frame.
let selectedLineage = -1;

const TRAIL_CAPACITY = 96;
const trail = new Float64Array(TRAIL_CAPACITY * 2);
let trailLength = 0;
let trailSlot = -1;

const metrics = new MetricsHistory();
const charts = new Charts(
  {
    'chart-pop': document.getElementById('chart-pop') as HTMLElement,
    'chart-energy': document.getElementById('chart-energy') as HTMLElement,
    'chart-traits': document.getElementById('chart-traits') as HTMLElement,
    'chart-species': document.getElementById('chart-species') as HTMLElement,
  },
  histogram,
);

const renderer = new Renderer(canvas);

function resize(): void {
  const size = renderer.resize();
  dpr = size.dpr;
  camera = fitCamera(world.params.worldWidth, world.params.worldHeight, size.pixelWidth, size.pixelHeight);
}
window.addEventListener('resize', resize);
resize();

function nearestOrganism(wx: number, wy: number): number {
  let best = -1;
  let bestD = 12; // pick tolerance in world units
  for (let i = 0; i < world.alive; i++) {
    const d = Math.hypot(world.x[i] - wx, world.y[i] - wy) - world.gene.radius[i];
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function selectAtWorld(wx: number, wy: number): void {
  const slot = nearestOrganism(wx, wy);
  selectedLineage = slot >= 0 ? world.lineage[slot] : -1;
  trailLength = 0;
  trailSlot = -1;
  isolateBox.checked = isolate;
}

canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  const wx = toWorldX(camera, cssToDevice(event.clientX, dpr));
  const wy = toWorldY(camera, cssToDevice(event.clientY, dpr));
  if (event.shiftKey) {
    selectAtWorld(wx, wy);
    return;
  }
  for (let n = 0; n < 8; n++) world.placeFood(wx + world.rng.range(-14, 14), wy + world.rng.range(-14, 14));
});

function setSpeed(value: number): void {
  speed = value;
  for (const button of speedButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === value));
}

function setPaused(value: boolean): void {
  paused = value;
  playPause.textContent = paused ? 'play' : 'pause';
  playPause.setAttribute('aria-pressed', String(!paused));
}

function setTurbo(value: boolean): void {
  turbo = value;
  turboButton.setAttribute('aria-pressed', String(value));
}

function setIsolate(value: boolean): void {
  isolate = value;
  isolateBox.checked = value;
}

isolateBox.addEventListener('change', () => setIsolate(isolateBox.checked));

function resetWorld(): void {
  const seed = seedInput.value.trim() || String(DEFAULT_PARAMS.seed);
  seedInput.value = seed;
  params.seed = seed;
  window.history.replaceState(null, '', `?seed=${encodeURIComponent(seed)}`);
  world = new World(params);
  clock = createClock();
  metrics.reset();
  charts.update(metrics);
  selectedLineage = -1;
  trailLength = 0;
  trailSlot = -1;
}

playPause.addEventListener('click', () => setPaused(!paused));
stepButton.addEventListener('click', () => {
  world.step();
  if (!turbo) draw(1);
});
turboButton.addEventListener('click', () => setTurbo(!turbo));
resetButton.addEventListener('click', resetWorld);
for (const button of speedButtons) {
  button.addEventListener('click', () => setSpeed(Number(button.dataset.speed)));
}

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space') {
    setPaused(!paused);
    event.preventDefault();
  } else if (event.key === 'n') {
    world.step();
  } else if (event.key === 't') {
    setTurbo(!turbo);
  } else if (event.key === 'i') {
    setIsolate(!isolate);
  } else if (event.key >= '1' && event.key <= '8') {
    // one key walks the allowed speeds 1 -> 2 -> 4 -> 8 -> 1
    setSpeed(nextSpeed(speed));
  }
});

function draw(alpha: number, selected = -1): void {
  renderer.draw(world, camera, {
    alpha,
    selected,
    isolateLineage: isolate ? selectedLineage : -1,
    trail: trailLength > 1 ? trail : null,
    trailLength,
  });
}

function pushTrail(slot: number): void {
  if (slot < 0) {
    trailLength = 0;
    trailSlot = -1;
    return;
  }
  if (slot !== trailSlot) {
    // a different slot means the array compacted or this organism died: start a fresh trail
    trailLength = 0;
    trailSlot = slot;
  }
  if (trailLength === TRAIL_CAPACITY) {
    trail.copyWithin(0, 2);
    trailLength--;
  }
  trail[trailLength * 2] = world.x[slot];
  trail[trailLength * 2 + 1] = world.y[slot];
  trailLength++;
}

function formatGene(name: string, value: number): string {
  const gene = GENES[name as keyof typeof GENES];
  return gene.max <= 1 ? value.toFixed(2) : value.toFixed(1);
}

function inspectorText(slot: number): string {
  if (selectedLineage < 0) return 'shift+click an organism to inspect it';
  if (slot < 0) return `lineage #${selectedLineage} died — its lineage stays isolated until you pick another`;
  const genes = GENE_NAMES.map((name) => `${name} ${formatGene(name, world.gene[name][slot])}`).join('\n  ');
  return [
    `lineage #${selectedLineage} · slot ${slot} · gen ${world.gen[slot]} · age ${Math.round(world.age[slot])} ticks`,
    `energy ${world.energy[slot].toFixed(0)}/${world.gene.reproThreshold[slot].toFixed(0)} · radius ${world.gene.radius[slot].toFixed(2)}`,
    `  ${genes}`,
  ].join('\n');
}

let lastFrame = performance.now();
const TURBO_TICK_MS = 12;
const MAX_TICKS_PER_FRAME = 16;
let lastHud = lastFrame;
let frames = 0;
let windowTicks = 0;
let windowSimMs = 0;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  const started = performance.now();
  const tickBefore = world.tick;
  let alpha = 1;
  let selected = -1;
  if (!paused) {
    if (turbo) {
      // Turbo spends ~12 ms of each frame on ticks and draws the rest of the frame, so the view
      // keeps moving instead of freezing at 2-3 fps.
      runTimeBoxed(world, 4000, TURBO_TICK_MS, () => performance.now());
    } else {
      alpha = advance(world, clock, elapsed, speed, MAX_TICKS_PER_FRAME);
    }
  }
  if (selectedLineage >= 0) selected = world.slotOfLineage(selectedLineage);
  pushTrail(selected);
  windowTicks += world.tick - tickBefore;
  windowSimMs += performance.now() - started;

  draw(alpha, selected);
  frames++;

  if (now - lastHud > 250) {
    const report = world.report();
    metrics.sample(report);
    charts.update(metrics);
    charts.drawHistogram(report.sizeBins);

    const m = report.means;
    const fps = Math.round((frames * 1000) / (now - lastHud));
    const msPerTick = windowTicks > 0 ? windowSimMs / windowTicks : 0;
    frames = 0;
    windowTicks = 0;
    windowSimMs = 0;
    lastHud = now;
    const lines = [
      `tick ${report.tick} · pop ${report.organisms} · food ${report.food} · gen ${report.meanGeneration.toFixed(2)} · species ${report.speciesCount}`,
      `${fps} fps · ${turbo ? 'turbo' : `${speed}x`} · ${msPerTick.toFixed(2)} ms/tick`,
      // means move as selection acts, so they are the quickest visible sign evolution is happening
      `mean genome · r ${m.radius.toFixed(1)} · v ${m.maxSpeed.toFixed(0)} · sense ${m.senseRadius.toFixed(0)} · meta ${m.metabolism.toFixed(2)} · seek ${m.seekFood.toFixed(2)} · flee ${m.flee.toFixed(2)}`,
    ];
    hud.textContent = lines.join('\n');
    inspector.textContent = inspectorText(selected);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Debug handle for the console and the headless check: poke the live world, count what the graph
// buffers hold (the bounded-memory claim is only meaningful with the real loop running).
(globalThis as Record<string, unknown>).arena = {
  world: () => world,
  params,
  renderer,
  charts: () => charts,
  metrics: () => metrics,
  memory: () => {
    // Chrome-only performance.memory; other browsers return null and the headless check says so.
    const withMemory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    return withMemory.memory ? { usedJSHeapSize: withMemory.memory.usedJSHeapSize } : null;
  },
  uPlotCount: () => document.querySelectorAll('.u-wrap').length,
  uPlotCanvases: () => document.querySelectorAll('.u-wrap canvas').length,
  // same code path a shift+click takes, so the headless check can select a known organism
  select: (index = 0) => selectAtWorld(world.x[index], world.y[index]),
  isolate: (value = true) => setIsolate(value),
};
