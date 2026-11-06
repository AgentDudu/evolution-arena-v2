// Browser entry: world + fixed-step loop + aerial renderer + the few controls needed to watch
// evolution happen. Sandbox depth (trait editor, events, edit log) comes later; this is the
// visible-arena work item.

import { DEFAULT_PARAMS, nextSpeed, type SimParams } from './core/config.ts';
import { cssToDevice, fitCamera, toWorldX, toWorldY, type Camera } from './render/camera.ts';
import { Renderer } from './render/renderer.ts';
import { advance, createClock, runTimeBoxed } from './sim/loop.ts';
import { World } from './sim/world.ts';

const canvas = document.getElementById('arena') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
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
let selected = -1;

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

canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  const wx = toWorldX(camera, cssToDevice(event.clientX, dpr));
  const wy = toWorldY(camera, cssToDevice(event.clientY, dpr));
  if (event.shiftKey) {
    selected = nearestOrganism(wx, wy);
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

function resetWorld(): void {
  const seed = seedInput.value.trim() || String(DEFAULT_PARAMS.seed);
  seedInput.value = seed;
  params.seed = seed;
  history.replaceState(null, '', `?seed=${encodeURIComponent(seed)}`);
  world = new World(params);
  clock = createClock();
  selected = -1;
}

playPause.addEventListener('click', () => setPaused(!paused));
stepButton.addEventListener('click', () => {
  world.step();
  if (!turbo) renderer.draw(world, camera, { alpha: 1, selected });
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
  } else if (event.key === 's') {
    setSpeed(nextSpeed(speed));
  }
});

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
  if (!paused) {
    if (turbo) {
      // Turbo spends ~12 ms of each frame on ticks and draws the rest of the frame, so the view
      // keeps moving instead of freezing at 2-3 fps. Cap 4000 ticks: a frame still cannot stall
      // forever on a huge population.
      runTimeBoxed(world, 4000, TURBO_TICK_MS, () => performance.now());
    } else {
      alpha = advance(world, clock, elapsed, speed, MAX_TICKS_PER_FRAME);
    }
  }
  windowTicks += world.tick - tickBefore;
  windowSimMs += performance.now() - started;

  renderer.draw(world, camera, { alpha, selected });
  frames++;

  if (now - lastHud > 250) {
    const report = world.report();
    const m = report.means;
    const fps = Math.round((frames * 1000) / (now - lastHud));
    const msPerTick = windowTicks > 0 ? windowSimMs / windowTicks : 0;
    frames = 0;
    windowTicks = 0;
    windowSimMs = 0;
    lastHud = now;
    const lines = [
      `tick ${report.tick} · pop ${report.organisms} · food ${report.food} · gen ${report.meanGeneration.toFixed(2)}`,
      `${fps} fps · ${turbo ? 'turbo' : `${speed}x`} · ${msPerTick.toFixed(2)} ms/tick`,
      // means move as selection acts, so they are the quickest visible sign evolution is happening
      `mean genome · r ${m.radius.toFixed(1)} · v ${m.maxSpeed.toFixed(0)} · sense ${m.senseRadius.toFixed(0)} · meta ${m.metabolism.toFixed(2)} · seek ${m.seekFood.toFixed(2)} · flee ${m.flee.toFixed(2)}`,
    ];
    if (selected >= 0 && selected < world.alive) {
      lines.push(
        `organism #${selected} · gen ${world.gen[selected]} · energy ${world.energy[selected].toFixed(0)}/${world.gene.reproThreshold[selected].toFixed(0)} · ` +
          `radius ${world.gene.radius[selected].toFixed(2)} · sense ${world.gene.senseRadius[selected].toFixed(0)} · ` +
          `speed ${world.gene.maxSpeed[selected].toFixed(0)} · hue ${world.gene.hue[selected].toFixed(0)}`,
      );
    }
    hud.textContent = lines.join('\n');
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Debug handle for the console: inspect or poke the live world.
(globalThis as Record<string, unknown>).arena = { world: () => world, params, renderer };
