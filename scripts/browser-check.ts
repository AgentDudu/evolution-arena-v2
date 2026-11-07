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

    // Sandbox release, driven through the same DOM path a person uses: copy the population's own
    // genome, change one gene, arm, click the arena. Gene defaults are a lethal genome in this food
    // web (senseRadius 80 costs 5 energy per tick against the ~1.7 the population settled on), which
    // is exactly why the button copies the wild mean instead of starting from the defaults.
    const sandbox = { placed: 0, surviving: 0, armedLabel: '', ringBefore: 0, ringAfter: 0, error: null };
    const ringPixels = (probe) => {
      const stage = document.getElementById('arena');
      const data = stage.getContext('2d').getImageData(0, 0, stage.width, stage.height).data;
      let hits = 0;
      let ink = 0;
      let maxR = 0;
      // ENGINEERED_RING #ffe36b is drawn at lineWidth 1, so most of its pixels are part-coverage
      // against the dark arena. What separates it from the yellow food class #c8e66a is the red/green
      // order: the ring is red-forward (255,227), the food is green-forward (200,230), and blending
      // towards the background keeps that order at any coverage. The before/after delta then cancels
      // the wild organisms whose hue happens to sit near yellow.
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] !== 0) ink++;
        if (data[i] > maxR) maxR = data[i];
        if (data[i] > data[i + 1] + 4 && data[i + 1] > data[i + 2] + 30 && data[i] > 90) hits++;
      }
      probe.ink = ink;
      probe.maxR = maxR;
      probe.width = stage.width;
      probe.height = stage.height;
      return hits;
    };
    try {
      // the inspector phase above turned isolate on, and dimmed organisms skip the ring pass
      window.arena.isolate(false);
      document.getElementById('engineer-wild').click();
      for (const pair of [['engineer-radius', 15.5], ['engineer-hue', 300]]) {
        const slider = document.getElementById(pair[0]);
        slider.value = String(pair[1]);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.getElementById('engineer-count').value = '12';
      document.getElementById('engineer-arm').click();
      sandbox.armedLabel = document.getElementById('engineer-arm').textContent;
      const stage = document.getElementById('arena');
      const box = stage.getBoundingClientRect();
      const beforeProbe = {};
      const afterProbe = {};
      sandbox.ringBefore = ringPixels(beforeProbe);
      stage.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          bubbles: true,
        }),
      );
      sandbox.placed = window.arena.engineeredCount();
      await new Promise((r) => setTimeout(r, 900));
      sandbox.surviving = window.arena.engineeredCount();
      sandbox.ringAfter = ringPixels(afterProbe);
      Object.assign(sandbox, {
        beforeInk: beforeProbe.ink,
        afterInk: afterProbe.ink,
        beforeMaxR: beforeProbe.maxR,
        afterMaxR: afterProbe.maxR,
        bufW: afterProbe.width,
        bufH: afterProbe.height,
      });
    } catch (sandboxFailure) {
      sandbox.error = String(sandboxFailure);
    }

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

    // The rest of the sandbox, through the same DOM path a person uses: delete mode plus a click on a
    // body, a sim slider that has to reach the running world, and the population events. Deliberately
    // after the soak, so the throughput and memory numbers above stay on an untouched population.
    const tools = {
      deleteLabel: '',
      aliveBefore: 0,
      aliveAfterDelete: 0,
      paramValue: 0,
      paramStatus: '',
      predationOff: null,
      catBefore: 0,
      catAfter: 0,
      foodBefore: 0,
      foodAfterBloom: 0,
      foodCap: 0,
      bloomStatus: '',
      events: 0,
      kinds: '',
      error: null,
    };
    try {
      const stage3 = document.getElementById('arena');
      const del = document.getElementById('engineer-delete');
      del.click();
      tools.deleteLabel = del.textContent;
      tools.aliveBefore = window.arena.world().alive;
      const body = window.arena.screenPoint(0);
      stage3.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: body.x, clientY: body.y, bubbles: true }),
      );
      tools.aliveAfterDelete = window.arena.world().alive;
      del.click(); // delete is a sticky mode: turn it back off so nothing else gets removed

      const slider = document.getElementById('sim-foodPerTick');
      slider.value = '25';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      tools.paramValue = window.arena.world().params.foodPerTick;
      tools.paramStatus = document.getElementById('sim-status').textContent;

      const predation = document.getElementById('sim-predation');
      predation.checked = false;
      predation.dispatchEvent(new Event('change', { bubbles: true }));
      tools.predationOff = window.arena.world().params.predationEnabled;

      tools.catBefore = window.arena.world().alive;
      document.getElementById('ev-cat').click();
      tools.catAfter = window.arena.world().alive;
      tools.foodBefore = window.arena.world().foodCount;
      document.getElementById('ev-bloom').click();
      tools.foodAfterBloom = window.arena.world().foodCount;
      tools.foodCap = window.arena.world().params.foodCap;
      tools.bloomStatus = document.getElementById('sim-status').textContent;
      document.getElementById('ev-burst').click();
      tools.events = window.arena.world().events.length;
      tools.kinds = window.arena.world().events.map((e) => e.kind).join(',');
    } catch (toolsFailure) {
      tools.error = String(toolsFailure);
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
      sandbox,
      tools,
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

const evaluated = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(evaluated, null, 2));
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
  sandbox?: { error?: string | null; placed?: number; surviving?: number; armedLabel?: string; ringBefore?: number; ringAfter?: number };
  tools?: {
    error?: string | null;
    deleteLabel?: string;
    aliveBefore?: number;
    aliveAfterDelete?: number;
    paramValue?: number;
    predationOff?: boolean | null;
    catBefore?: number;
    catAfter?: number;
    foodBefore?: number;
    foodAfterBloom?: number;
    foodCap?: number;
    bloomStatus?: string;
    events?: number;
    kinds?: string;
  };
};
const payload = ((evaluated.result as { result?: { value?: Payload } } | undefined)?.result?.value ?? {}) as Payload;

// Stage two: open the share link as a fresh page. That is what work item 7 promises - the link has to
// rebuild the sender's exact world, event log included, in a browser that never saw the run. The
// restored run arrives paused, so the hash is read at the sender's tick instead of a tick or two later.
type Replay = {
  error?: string;
  status?: string;
  tick?: number;
  hash?: number;
  paused?: string;
  senderTick?: number;
  senderHash?: number;
  linkChars?: number;
  linkEvents?: number;
};
let replay: Replay = {};
try {
  const built = await call('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('run-share').click();
      const w = window.arena.world();
      return JSON.stringify({
        link: document.getElementById('run-link').value,
        tick: w.tick,
        hash: w.stateHash(),
        events: w.events.length,
      });
    })()`,
    returnByValue: true,
  });
  const sender = JSON.parse(String((built.result as { result?: { value?: string } } | undefined)?.result?.value ?? '{}')) as {
    link?: string;
    tick?: number;
    hash?: number;
    events?: number;
  };
  if (!sender.link) throw new Error('the share button produced no link');
  replay = { senderTick: sender.tick, senderHash: sender.hash, linkChars: sender.link.length, linkEvents: sender.events };
  await call('Page.enable');
  await call('Page.navigate', { url: sender.link });
  for (let attempt = 0; attempt < 240; attempt++) {
    await sleep(500);
    const now = await call('Runtime.evaluate', {
      expression: `(() => {
        const w = window.arena && window.arena.world();
        return JSON.stringify({
          status: document.getElementById('run-status') ? document.getElementById('run-status').textContent : '',
          paused: document.getElementById('playpause') ? document.getElementById('playpause').textContent : '',
          tick: w ? w.tick : -1,
          hash: w ? w.stateHash() : -1,
        });
      })()`,
      returnByValue: true,
    });
    const seen = JSON.parse(String((now.result as { result?: { value?: string } } | undefined)?.result?.value ?? '{}')) as {
      status?: string;
      paused?: string;
      tick?: number;
      hash?: number;
    };
    if ((seen.status ?? '').includes('loaded') || (seen.status ?? '').includes('refused')) {
      replay = { ...replay, status: seen.status, paused: seen.paused, tick: seen.tick, hash: seen.hash };
      break;
    }
  }
} catch (error) {
  replay = { ...replay, error: String(error) };
}
console.log('share replay:', JSON.stringify(replay));

// Stage three: open the page with no seed and no link at all. That is the autosave path - the browser
// profile still holds the last run, and the page is supposed to pick it up instead of starting fresh.
let autosave: { status?: string; tick?: number; error?: string } = {};
if (!replay.error) {
  try {
    await call('Page.navigate', { url: url.split('?')[0] });
    for (let attempt = 0; attempt < 120; attempt++) {
      await sleep(500);
      const now = await call('Runtime.evaluate', {
        expression: `(() => {
          const w = window.arena && window.arena.world();
          return JSON.stringify({
            status: document.getElementById('run-status') ? document.getElementById('run-status').textContent : '',
            tick: w ? w.tick : -1,
          });
        })()`,
        returnByValue: true,
      });
      const seen = JSON.parse(String((now.result as { result?: { value?: string } } | undefined)?.result?.value ?? '{}')) as {
        status?: string;
        tick?: number;
      };
      if ((seen.status ?? '').includes('loaded') || (seen.status ?? '').includes('refused')) {
        autosave = { status: seen.status, tick: seen.tick };
        break;
      }
    }
  } catch (error) {
    autosave = { ...autosave, error: String(error) };
  }
}
console.log('autosave restore:', JSON.stringify(autosave));

// count the evidence instead of eyeballing the JSON: these are what the feature work is supposed to prove
const gates: string[] = [];
if (payload.error === undefined) {
  if ((payload.inkRatio ?? 0) < 0.01) gates.push('arena canvas painted nothing');
  if (!payload.bigFoodInkPixels) gates.push('the large food class was never painted');
  if ((payload.graph?.panels ?? 0) < 4) gates.push('fewer than 4 graph panels');
  if ((payload.graph?.uPlotCanvases ?? 0) < 4) gates.push('uPlot canvases missing');
  if (!payload.graph?.histogramInkPixels) gates.push('the size histogram painted nothing');
  if (payload.inspector?.isolateToggled !== true) gates.push('isolate did not toggle');
  if (payload.sandbox?.error) gates.push(`sandbox release threw ${payload.sandbox.error}`);
  if ((payload.sandbox?.placed ?? 0) < 12) gates.push('the release placed fewer than 12 organisms');
  if ((payload.sandbox?.surviving ?? 0) < 1) gates.push('the released lineage died on the spot');
  if ((payload.sandbox?.ringAfter ?? 0) - (payload.sandbox?.ringBefore ?? 0) < 40) gates.push('no engineered ring pixels appeared');
  if (!payload.sandbox?.armedLabel?.includes('release')) gates.push('arming did not change the button label');
  if (payload.tools?.error) gates.push(`sandbox tools threw ${payload.tools.error}`);
  if (payload.tools && (payload.tools.aliveAfterDelete ?? 0) >= (payload.tools.aliveBefore ?? 0)) gates.push('a delete-mode click removed nothing');
  if (!payload.tools?.deleteLabel?.includes('delete')) gates.push('delete mode did not change its button label');
  if (payload.tools?.paramValue !== 25) gates.push(`the foodPerTick slider reached ${String(payload.tools?.paramValue)} in the running world, not 25`);
  if (payload.tools?.predationOff !== false) gates.push('the predation checkbox did not reach the running world');
  if (payload.tools && (payload.tools.catAfter ?? 0) > (payload.tools.catBefore ?? 0) * 0.9) gates.push('catastrophe did not cut the population');
  if (!payload.tools?.bloomStatus?.includes('food bloom')) gates.push('the food bloom button did not run');
  if (payload.tools && ((payload.tools.foodAfterBloom ?? 0) < (payload.tools.foodBefore ?? 0) || (payload.tools.foodAfterBloom ?? 0) > (payload.tools.foodCap ?? 0))) gates.push('food bloom went past the food cap');
  if ((payload.tools?.events ?? 0) < 5) gates.push(`the event log recorded ${String(payload.tools?.events)} perturbations, expected at least 5 (${payload.tools?.kinds ?? 'none'})`);
  if (replay.error) gates.push(`the share replay stage threw ${replay.error}`);
  if (!replay.error && replay.hash !== replay.senderHash) {
    gates.push(`the share link rebuilt a different world: tick ${String(replay.tick)} hash ${String(replay.hash)} vs sender tick ${String(replay.senderTick)} hash ${String(replay.senderHash)}`);
  }
  if (!replay.error && replay.tick !== replay.senderTick) gates.push(`the share link landed on tick ${String(replay.tick)}, the sender was at ${String(replay.senderTick)}`);
  if (!replay.error && (replay.linkEvents ?? 0) < 5) gates.push(`the share link carried only ${String(replay.linkEvents)} events`);
  if (!(replay.status ?? '').includes('matches the sender')) gates.push(`the page did not report a hash match (${String(replay.status)})`);
  if (!replay.error && replay.paused !== 'play') gates.push(`the restored run was left running (play button reads "${String(replay.paused)}"), so its state kept moving away from the shared one`);
  if (autosave.error) gates.push(`the autosave stage threw ${autosave.error}`);
  if (!replay.error && !(autosave.status ?? '').includes('autosave loaded')) gates.push(`opening the page with no seed and no link did not pick up the autosaved run (${String(autosave.status)})`);
  if (!replay.error && !(autosave.status ?? '').includes('matches the sender')) gates.push('the autosaved run did not replay to its own state hash');
  if (!payload.inspector?.text?.includes('lineage')) gates.push('inspector produced no genome');
}
if (gates.length > 0) console.log('gates failed:', gates);

socket.close();
browser.kill();
process.exitCode =
  problems.length > 0 || payload.error !== undefined || payload.soak?.error != null || gates.length > 0 ? 1 : 0;
