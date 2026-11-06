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

    document.getElementById('turbo').click();
    const turboStartTick = w.tick;
    const turboStart = performance.now();
    await new Promise((r) => setTimeout(r, ${Math.round(seconds * 1000)}));
    const afterTurbo = window.arena.world();
    const turbo = { ticks: afterTurbo.tick - turboStartTick, perSecond: (afterTurbo.tick - turboStartTick) / ((performance.now() - turboStart) / 1000) };
    document.getElementById('turbo').click();

    return {
      realtime,
      turbo,
      speedCycle: speedBefore + 'x --key s--> ' + speedAfterKey + 'x',
      population: afterTurbo.alive,
      food: afterTurbo.foodCount,
      meanGeneration: Number(afterTurbo.report().meanGeneration.toFixed(2)),
      inkRatio: Number((ink / (data.length / 4)).toFixed(4)),
      canvasPixels: [el.width, el.height],
      hud: document.getElementById('hud').textContent,
    };
  } catch (error) {
    return { error: String(error), hasArena: typeof window.arena };
  }
})()`;

const { webSocketDebuggerUrl } = await target();
const socket = new WebSocket(webSocketDebuggerUrl);
const problems: string[] = [];

await new Promise<void>((resolve, reject) => {
  socket.addEventListener('error', () => reject(new Error('websocket failed')));
  socket.addEventListener('open', () => resolve());
});

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
const evaluated = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(evaluated, null, 2));
if (problems.length > 0) console.log('page exceptions:', problems);

socket.close();
browser.kill();
process.exitCode = problems.length > 0 || JSON.stringify(evaluated).includes('error') ? 1 : 0;
