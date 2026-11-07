// Browser entry: world + fixed-step loop + aerial renderer + graphs + organism inspector + the
// sandbox tools (release a designed genome, delete one, change the sim and fire events mid-run).

import { Charts } from './render/charts.ts';
import { MetricsHistory } from './sim/history.ts';

import { DEFAULT_PARAMS, GENES, GENE_NAMES, nextSpeed, type GeneName, type SimParams } from './core/config.ts';
import { cssToDevice, fitCamera, toPixelX, toPixelY, toWorldX, toWorldY, type Camera } from './render/camera.ts';
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
const engineerGenes = document.getElementById('engineer-genes') as HTMLElement;
const engineerCount = document.getElementById('engineer-count') as HTMLInputElement;
const engineerArm = document.getElementById('engineer-arm') as HTMLButtonElement;
const engineerWild = document.getElementById('engineer-wild') as HTMLButtonElement;
const engineerDelete = document.getElementById('engineer-delete') as HTMLButtonElement;
const eventBloom = document.getElementById('ev-bloom') as HTMLButtonElement;
const eventCatastrophe = document.getElementById('ev-cat') as HTMLButtonElement;
const eventBurst = document.getElementById('ev-burst') as HTMLButtonElement;
const simParamsBox = document.getElementById('sim-params') as HTMLElement;
const simStatus = document.getElementById('sim-status') as HTMLElement;
const simPredation = document.getElementById('sim-predation') as HTMLInputElement;
const simReseed = document.getElementById('sim-reseed') as HTMLInputElement;
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

// The release tool: sliders set a genome, arming makes the next canvas click place it. Values are kept
// as a partial genome and clamped inside World.engineer, so the editor cannot express a creature the
// genetics cannot.
const genome: Partial<Record<GeneName, number>> = {};
const sliderFor = new Map<GeneName, HTMLInputElement>();
const readoutFor = new Map<GeneName, HTMLElement>();
for (const name of GENE_NAMES) {
  const spec = GENES[name];
  const label = document.createElement('label');
  label.textContent = name;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = spec.max <= 1 ? '0.05' : String(Math.round(((spec.max - spec.min) / 100) * 100) / 100);
  input.value = String(spec.def);
  input.id = `engineer-${name}`;
  label.htmlFor = input.id;
  input.setAttribute('aria-label', name);
  const value = document.createElement('span');
  value.className = 'v';
  value.textContent = formatGene(name, spec.def);
  genome[name] = spec.def;
  input.addEventListener('input', () => {
    genome[name] = Number(input.value);
    value.textContent = formatGene(name, Number(input.value));
  });
  sliderFor.set(name, input);
  readoutFor.set(name, value);
  label.append(input, value);
  engineerGenes.append(label);
}

/** Start from what the population already runs on, then change one trait. Gene defaults are a bad
 *  starting point on purpose of measurement: a genome off the gene defaults (senseRadius 80 costs
 *  0.0008 * sense^2 = 5 energy per tick against the ~1.7 the population settled on) gets eaten or
 *  starves inside 100 ticks, which reads as a broken tool rather than as selection. */
function setGenomeFrom(values: Partial<Record<GeneName, number>>): void {
  for (const name of GENE_NAMES) {
    const spec = GENES[name];
    const v = Math.min(spec.max, Math.max(spec.min, values[name] ?? spec.def));
    genome[name] = v;
    const input = sliderFor.get(name);
    if (input !== undefined) input.value = String(v);
    readoutFor.get(name)?.replaceChildren(formatGene(name, v));
  }
}

let armed = false;
let deleting = false;

/**
 * Sim knobs the running world accepts. Keys that size buffers and grids (world size, maxOrganisms,
 * foodCap) or fix the run's identity (seed, dt, wallMode) get no control here, because
 * World.setParams refuses them — a slider that can only ever error is worse than no slider.
 */
const LIVE_PARAMS: { key: keyof SimParams; min: number; max: number; step: number }[] = [
  { key: 'foodPerTick', min: 0, max: 60, step: 1 },
  { key: 'bigFoodShare', min: 0, max: 1, step: 0.05 },
  { key: 'foodSmallPenalty', min: 0, max: 1, step: 0.05 },
  { key: 'predationRatio', min: 1, max: 3, step: 0.05 },
  { key: 'preyMinRadius', min: 0, max: 16, step: 0.5 },
  { key: 'mutationRate', min: 0, max: 1, step: 0.01 },
];

function setSimStatus(text: string): void {
  simStatus.textContent = text;
}

/** A control must never display a value the sim refused, so a rejected edit puts the control back. */
function applyParam(key: keyof SimParams, value: number | boolean, input?: HTMLInputElement): void {
  try {
    world.setParams({ [key]: value } as Partial<SimParams>);
    // the page holds its own params object and resetWorld builds the next world from it, so the edit
    // has to land there too or a reset silently drops what the slider set
    Object.assign(params, { [key]: value });
    setSimStatus(`${String(key)} = ${String(value)}`);
  } catch (err) {
    if (input !== undefined) input.value = String(world.params[key]);
    setSimStatus(`refused: ${String((err as Error).message).split('\n')[0]}`);
  }
}

const formatParam = (spec: { key: keyof SimParams; max: number }, value: unknown): string =>
  typeof value === 'number' ? (spec.max <= 1 ? value.toFixed(2) : String(Math.round(value * 100) / 100)) : String(value);

for (const spec of LIVE_PARAMS) {
  const label = document.createElement('label');
  label.textContent = String(spec.key);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(params[spec.key]);
  input.id = `sim-${String(spec.key)}`;
  label.htmlFor = input.id;
  input.setAttribute('aria-label', String(spec.key));
  const value = document.createElement('span');
  value.className = 'v';
  value.textContent = formatParam(spec, params[spec.key]);
  input.addEventListener('input', () => {
    applyParam(spec.key, Number(input.value), input);
    input.value = String(world.params[spec.key]);
    value.textContent = formatParam(spec, world.params[spec.key]);
  });
  label.append(input, value);
  simParamsBox.append(label);
}

simPredation.checked = params.predationEnabled;
simReseed.checked = params.reseedOnEmpty;
simPredation.addEventListener('change', () => applyParam('predationEnabled', simPredation.checked, simPredation));
simReseed.addEventListener('change', () => applyParam('reseedOnEmpty', simReseed.checked, simReseed));

eventBloom.addEventListener('click', () => setSimStatus(`food bloom · +${world.foodBloom()} particles`));
eventCatastrophe.addEventListener('click', () => {
  const before = world.alive;
  const killed = world.catastrophe(0.5);
  setSimStatus(`catastrophe · ${killed} of ${before} died`);
});
eventBurst.addEventListener('click', () => setSimStatus(`mutation burst · ${world.mutationBurst()} genomes nudged`));

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

function selectAtWorld(wx: number, wy: number): void {
  // 12 world units of slack for picking: a pointer is not a scalpel, and the organism nearest the
  // point within that slack wins
  const slot = world.organismAt(wx, wy, 12);
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
  if (armed) {
    releaseEngineered(wx, wy);
    return;
  }
  if (deleting) {
    // tight slack here on purpose: removing the wrong organism is worse than missing one
    const slot = world.organismAt(wx, wy);
    if (slot >= 0) {
      // read the lineage before the delete: compaction moves the last organism into the freed slot
      setSimStatus(`deleted lineage #${world.lineage[slot]}`);
      world.deleteAt(slot);
    }
    return;
  }
  for (let n = 0; n < 8; n++) world.placeFood(wx + world.rng.range(-14, 14), wy + world.rng.range(-14, 14));
});

engineerWild.addEventListener('click', () => setGenomeFrom(world.report().means));
engineerArm.addEventListener('click', () => setArmed(!armed));
engineerDelete.addEventListener('click', () => setDeleting(!deleting));

function setArmed(value: boolean): void {
  armed = value;
  if (value) setDeleting(false);
  engineerArm.setAttribute('aria-pressed', String(value));
  engineerArm.textContent = value ? 'click the arena to release' : 'arm placement (e)';
}

/** Delete is a sticky mode rather than a one-shot arm: clearing a bad lineage means several clicks. */
function setDeleting(value: boolean): void {
  deleting = value;
  if (value) setArmed(false);
  engineerDelete.setAttribute('aria-pressed', String(value));
  engineerDelete.textContent = value ? 'click an organism to delete it' : 'delete (x)';
}

/** Drop the edited genome into the live population. One release per arming, so a runaway click
 *  cannot bury the wild population by accident. Returns how many were placed. */
function releaseEngineered(wx: number, wy: number, count = Number(engineerCount.value), genes = genome): number {
  const n = Math.max(1, Math.min(50, Math.round(Number.isFinite(count) ? count : 1)));
  let placed = 0;
  for (let k = 0; k < n; k++) {
    // jitter spreads them instead of stacking every release on one point; the world rng keeps it
    // reproducible for a given seed
    if (world.engineer(wx + world.rng.range(-16, 16), wy + world.rng.range(-16, 16), genes) >= 0) placed++;
  }
  setArmed(false);
  return placed;
}

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
  } else if (event.key === 'e') {
    setArmed(!armed);
  } else if (event.key === 'x') {
    setDeleting(!deleting);
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
    if (report.engineered > 0) {
      lines.push(`engineered ${report.engineered} of ${report.organisms} · mean r ${report.engineeredMeanRadius.toFixed(1)}`);
    }
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
  // where an organism sits on screen, so the headless check can click a real body instead of guessing
  screenPoint: (index = 0) => ({
    x: canvas.getBoundingClientRect().left + toPixelX(camera, world.x[index]) / dpr,
    y: canvas.getBoundingClientRect().top + toPixelY(camera, world.y[index]) / dpr,
  }),
  // release with an exact genome at a known point, bypassing the sliders: how the headless check
  // proves the tool reaches the world
  engineer: (genes: Partial<Record<GeneName, number>> = {}, count = 1, x = params.worldWidth / 2, y = params.worldHeight / 2) =>
    releaseEngineered(x, y, count, genes),
  engineeredCount: () => world.report().engineered,
};
