// Browser smoke check: launches headless Edge/Chrome over CDP (no extra deps), loads the built
// app, lets the loop run, and prints live world numbers plus any page exception.
// Usage: node scripts/browser-check.ts [url] [seconds]

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const url = process.argv[2] ?? 'http://localhost:4321/?seed=check';
const seconds = Number(process.argv[3] ?? 4);
// Optional longer turbo soak: prints heap and buffer occupancy every 10 s, which is how the
// "no heap growth" half of the graphs done-when gets measured in a real browser.
const soakSeconds = Number(process.argv[4] ?? 0);
const port = 9333;

const bin = CANDIDATES.find((p) => existsSync(p));
if (bin === undefined) {
  console.error('no Edge/Chrome found; run the check in a browser manually');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'arena-cdp-'));
const browser = spawn(bin, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  // exposes window.gc() so the soak can report heap after a real collection, not Chrome's lazily
  // deferred one — otherwise "no heap growth" cannot be told apart from "not collected yet"
  '--js-flags=--expose-gc',
  '--window-size=1280,720',
  'about:blank',
]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function target(): Promise<{ webSocketDebuggerUrl: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        url?: string;
        webSocketDebuggerUrl?: string;
      }[];
      // Attach to the page we just opened, not the browser's blank start page.
      const page = list.find((t) => t.type === 'page' && t.url === url && t.webSocketDebuggerUrl !== undefined);
      if (page?.webSocketDebuggerUrl !== undefined && created.ok) return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
    } catch {
      /* browser still starting */
    }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

const expression = `(async () => {
  try {
    const el = document.getElementById('arena');
    // one key cycles playback speed, so check the keybind drives the buttons, not just the label
    const speedOn = () =>
      [...document.querySelectorAll('button[data-speed]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.speed;
    const speedBefore = speedOn();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    const speedAfterKey = speedOn();
    const before = window.arena.world().tick;
    const start = performance.now();
    await new Promise((r) => setTimeout(r, ${Math.round(seconds * 1000)}));
    const w = window.arena.world();
    const realtime = { ticks: w.tick - before, perSecond: (w.tick - before) / ((performance.now() - start) / 1000) };

    // canvas is actually painted, not just sized: count pixels that differ from the arena background
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 11 || data[i + 1] !== 15 || data[i + 2] !== 20) ink++;
    }

    // the large food class must be visible as its own colour, not merely "something on canvas"
    let bigFoodInk = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 200 && data[i + 1] === 230 && data[i + 2] === 106) bigFoodInk++;
    }

    // graph panels exist and painted: 4 uPlot roots + a histogram with visible bars
    const panels = window.arena.uPlotCount();
    const hist = document.getElementById('histogram');
    const hdata = hist.getContext('2d').getImageData(0, 0, hist.width, hist.height).data;
    let histInk = 0;
    for (let i = 3; i < hdata.length; i += 4) if (hdata[i] !== 0) histInk++;
    const uPlotInk = window.arena.uPlotCanvases();

    // inspector: select a known organism through the same path shift+click uses, then toggle isolate
    window.arena.select(0);
    await new Promise((r) => setTimeout(r, 400));
    const inspectorText = document.getElementById('inspector').textContent.slice(0, 90);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    const isolated = document.getElementById('isolate').checked;

    const heapBefore = window.arena.memory();
    const samplesBefore = window.arena.metrics().length;

    document.getElementById('turbo').click();
    const turboStartTick = w.tick;
    const turboStart = performance.now();
    await new Promise((r) => setTimeout(r, ${Math.round(seconds * 1000)}));
    const afterTurbo = window.arena.world();
    const turbo = { ticks: afterTurbo.tick - turboStartTick, perSecond: (afterTurbo.tick - turboStartTick) / ((performance.now() - turboStart) / 1000) };
    document.getElementById('turbo').click();

    const metrics = window.arena.metrics();
    const heapAfter = window.arena.memory();
    const mb = (m) => (m === null ? null : Math.round((m.usedJSHeapSize / 1048576) * 10) / 10);

    // heap and buffer samples across a sustained turbo run; the buffer must never pass capacity.
    // The points array lives outside the try so a failure halfway still reports what was measured.
    const soakPoints = [];
    const soak = { seconds: ${soakSeconds}, points: soakPoints, ticksRun: 0, error: null, worldType: null, arenaKeys: null };
    if (${soakSeconds} > 0) {
      try {
        soak.worldType = typeof window.arena.world;
        soak.arenaKeys = Object.keys(window.arena);
        document.getElementById('turbo').click();
        const soakStartTick = window.arena.world().tick;
        for (let i = 0; i < Math.ceil(${soakSeconds} / 10); i++) {
          await new Promise((r) => setTimeout(r, 10000));
          if (globalThis.gc) globalThis.gc();
          await new Promise((r) => setTimeout(r, 100));
          const m = window.arena.metrics();
          const w2 = window.arena.world();
          soakPoints.push({
            atSeconds: (i + 1) * 10,
            tick: w2.tick,
            pop: w2.alive,
            heapMB: mb(window.arena.memory()),
            samples: m.length,
            capacity: m.capacity,
            stride: m.stride,
          });
        }
        soak.ticksRun = window.arena.world().tick - soakStartTick;
        document.getElementById('turbo').click();
      } catch (soakFailure) {
        soak.error = String(soakFailure);
        soak.href = location.href;
      }
    }

    return {
      realtime,
      turbo,
      speedCycle: speedBefore + 'x --key s--> ' + speedAfterKey + 'x',
      population: afterTurbo.alive,
      food: afterTurbo.foodCount,
      meanGeneration: Number(afterTurbo.report().meanGeneration.toFixed(2)),
      inkRatio: Number((ink / (data.length / 4)).toFixed(4)),
      bigFoodInkPixels: bigFoodInk,
      canvasPixels: [el.width, el.height],
      graph: {
        panels,
        uPlotCanvases: uPlotInk,
        histogramInkPixels: histInk,
        samplesBefore,
        samplesAfter: metrics.length,
        capacity: metrics.capacity,
        stride: metrics.stride,
        coveredTicks: metrics.length > 1 ? metrics.tick[metrics.length - 1] - metrics.tick[0] : 0,
        heapMB: { before: mb(heapBefore), after: mb(heapAfter) },
      },
      soak,
      inspector: { text: inspectorText, isolateToggled: isolated },
      hud: document.getElementById('hud').textContent,
    };
  } catch (error) {
    return {
      error: String(error),
      hasArena: typeof window.arena,
      arenaKeys: window.arena ? Object.keys(window.arena) : null,
      url: location.href,
    };
  }
})()`;

const { webSocketDebuggerUrl } = await target();
const socket = new WebSocket(webSocketDebuggerUrl);
const problems: string[] = [];

await new Promise<void>((resolve, reject) => {
  socket.addEventListener('error', () => reject(new Error('websocket failed')));
  socket.addEventListener('open', () => resolve());
});

// A target appears in /json/list before its document has committed, so evaluating straight away can
// land on the browser's blank start page (window.arena undefined, location about:blank).
async function waitForApp(): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await call('Runtime.evaluate', {
      expression: 'String(!!(window.arena && document.getElementById("arena")))',
      returnByValue: true,
    });
    if (String(probe.result?.result?.value) === 'true') return true;
    await sleep(250);
  }
  return false;
}

function parse(data: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(String(data)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

let nextId = 1;
function call(method: string, params: Record<string, unknown> = {}): Promise<{ result?: { result?: { value?: unknown } } }> {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const message = parse(event.data);
      if (message !== null && message['id'] === id) {
        socket.removeEventListener('message', onMessage);
        resolve(message as { result?: { result?: { value?: unknown } } });
      }
    };
    socket.addEventListener('message', onMessage);
  });
}

socket.addEventListener('message', (event: MessageEvent) => {
  const message = parse(event.data);
  if (message?.['method'] === 'Runtime.exceptionThrown') {
    const params = message['params'] as { exceptionDetails?: { text?: string; exception?: { description?: string } } } | undefined;
    const d = params?.exceptionDetails;
    problems.push(d?.exception?.description ?? d?.text ?? 'unknown exception');
  }
});

await call('Runtime.enable');
// the probe has to run after the CDP call helpers exist, otherwise nextId is still in its TDZ
if (!(await waitForApp())) problems.push('the app never loaded on the attached target');

const evaluated = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });console.log(JSON.stringify(evaluated, null, 2));
if (problems.length > 0) console.log('page exceptions:', problems);

// the payload carries an `error` only when something actually threw; a null soak.error is normal,
// so a substring search over the whole JSON would fail every run
type Payload = {
  error?: string;
  soak?: { error?: string | null };
  inkRatio?: number;
  bigFoodInkPixels?: number;
  graph?: { panels?: number; uPlotCanvases?: number; histogramInkPixels?: number };
  inspector?: { text?: string; isolateToggled?: boolean };
};
const payload = ((evaluated.result as { result?: { value?: Payload } } | undefined)?.result?.value ?? {}) as Payload;

// count the evidence instead of eyeballing the JSON: these are what the feature work is supposed to prove
const gates: string[] = [];
if (payload.error === undefined) {
  if ((payload.inkRatio ?? 0) < 0.01) gates.push('arena canvas painted nothing');
  if (!payload.bigFoodInkPixels) gates.push('the large food class was never painted');
  if ((payload.graph?.panels ?? 0) < 4) gates.push('fewer than 4 graph panels');
  if ((payload.graph?.uPlotCanvases ?? 0) < 4) gates.push('uPlot canvases missing');
  if (!payload.graph?.histogramInkPixels) gates.push('the size histogram painted nothing');
  if (payload.inspector?.isolateToggled !== true) gates.push('isolate did not toggle');
  if (!payload.inspector?.text?.includes('lineage')) gates.push('inspector produced no genome');
}
if (gates.length > 0) console.log('gates failed:', gates);

socket.close();
browser.kill();
process.exitCode =
  problems.length > 0 || payload.error !== undefined || payload.soak?.error != null || gates.length > 0 ? 1 : 0;
