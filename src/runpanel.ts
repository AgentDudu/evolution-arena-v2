// Run persistence for the sandbox panel (work item 7): a share link, named slots in localStorage,
// autosave that survives a reload, and CSV/JSON export of the sampled metrics.
//
// All of it travels through the same two functions the tests prove: encodeRun packs
// (seed, starting params, tick count, event log) and replayRun rebuilds the world by ticking that.
// The panel prints whether the replayed state hash equals the sender's, because that comparison is
// the whole claim - a link that silently replayed a different world would be worse than no link.

import type { MetricsHistory } from './sim/history.ts';
import { METRIC_COLUMNS } from './sim/history.ts';
import { decodeRun, encodeRun, replayRun, shareLink, type RunState } from './sim/share.ts';
import type { World } from './sim/world.ts';

export interface RunPanelHost {
  getWorld: () => World;
  metrics: () => MetricsHistory;
  /** A restored run arrives frozen at the shared moment, so the viewer inspects exactly the state the
   *  sender shared instead of whatever the sim did in the second it took to read it. */
  pause: () => void;
  /** Swap in a restored world. The caller resets the clock, buffers and selection around it. */
  setWorld: (world: World) => void;
}

const AUTOSAVE_KEY = 'arena.autosave.v1';
const SLOTS_KEY = 'arena.slots.v1';
const AUTOSAVE_MS = 5000;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

export function initRunPanel(host: RunPanelHost): { maybeAutosave: (now: number) => void; restoredFrom: () => string | null } {
  const share = el<HTMLButtonElement>('run-share');
  const linkBox = el<HTMLInputElement>('run-link');
  const nameBox = el<HTMLInputElement>('run-name');
  const saveBtn = el<HTMLButtonElement>('run-save');
  const slotsBox = el<HTMLSelectElement>('run-slots');
  const loadBtn = el<HTMLButtonElement>('run-load');
  const forgetBtn = el<HTMLButtonElement>('run-forget');
  const statusEl = el<HTMLElement>('run-status');
  const csvBtn = el<HTMLButtonElement>('export-csv');
  const jsonBtn = el<HTMLButtonElement>('export-json');

  let restoredFrom: string | null = null;
  const say = (message: string) => {
    if (statusEl) statusEl.textContent = message;
  };

  function readSlots(): Record<string, string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '{}') as unknown;
      if (typeof parsed !== 'object' || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }

  function refreshSlots(): void {
    if (!slotsBox) return;
    const names = Object.keys(readSlots()).sort();
    slotsBox.replaceChildren(
      ...names.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        return option;
      }),
    );
  }

  function writeSlots(next: Record<string, string>): void {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    } catch {
      say('browser storage refused the save');
    }
    refreshSlots();
  }

  /** Replay in wall-clock slices so a long run does not lock the tab while it rebuilds. The sim loop
   *  keeps drawing the current world meanwhile; the swap happens when the last tick lands. */
  function restore(text: string | null, label: string): void {
    if (!text) return;
    let run: RunState;
    try {
      run = decodeRun(text);
    } catch (error) {
      say(`${label} refused: ${(error as Error).message}`);
      return;
    }
    say(`${label}: replaying ${run.tick} ticks`);
    const it = replayRun(run);
    const pump = () => {
      const until = performance.now() + 150;
      let done = 0;
      let result = it.next();
      while (!result.done && performance.now() < until) {
        done = result.value;
        result = it.next();
      }
      if (result.done) {
        host.setWorld(result.value);
        host.pause();
        const matched = result.value.stateHash() === run.hash;
        say(
          `${label} loaded · tick ${run.tick} · pop ${result.value.report().organisms} · state hash ${
            matched ? 'matches the sender' : `does NOT match (sender ${run.hash}, this build ${result.value.stateHash()})`
          } · paused`,
        );
        restoredFrom = label;
        return;
      }
      say(`${label}: replayed ${done} of ${run.tick} ticks`);
      setTimeout(pump, 0);
    };
    pump();
  }

  share?.addEventListener('click', () => {
    try {
      const link = shareLink(host.getWorld());
      if (linkBox) linkBox.value = link;
      const base = `tick ${host.getWorld().tick} · ${host.getWorld().events.length} events · ${link.length} chars of link`;
      say(base);
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(link).then(
          () => say(`${base} · link copied`),
          () => say(`${base} · copy blocked, select the link above`),
        );
      }
    } catch (error) {
      say((error as Error).message);
    }
  });

  saveBtn?.addEventListener('click', () => {
    const name = (nameBox?.value ?? '').trim();
    if (!name) {
      say('type a slot name first');
      return;
    }
    try {
      const next = readSlots();
      next[name] = encodeRun(host.getWorld());
      writeSlots(next);
      say(`saved "${name}" at tick ${host.getWorld().tick}`);
      if (nameBox) nameBox.value = '';
    } catch (error) {
      say((error as Error).message);
    }
  });

  loadBtn?.addEventListener('click', () => {
    const name = slotsBox?.value ?? '';
    if (!name) {
      say('pick a slot to load');
      return;
    }
    restore(readSlots()[name], `slot "${name}"`);
  });

  forgetBtn?.addEventListener('click', () => {
    const name = slotsBox?.value ?? '';
    if (!name) {
      say('pick a slot to forget');
      return;
    }
    const next = readSlots();
    delete next[name];
    writeSlots(next);
    say(`forgot "${name}"`);
  });

  function download(file: string, mime: string, body: string): void {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([body], { type: mime }));
    anchor.download = file;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function exportSamples(metrics: MetricsHistory, asJson: boolean): void {
    const n = metrics.length;
    if (n === 0) {
      say('nothing sampled yet');
      return;
    }
    const world = host.getWorld();
    const stem = `arena-${String(world.initialParams.seed)}-tick${world.tick}`;
    if (asJson) {
      const samples: Record<string, number>[] = [];
      for (let i = 0; i < n; i++) {
        const row: Record<string, number> = { tick: metrics.tick[i] };
        for (const column of METRIC_COLUMNS) row[column] = metrics.series[column][i];
        samples.push(row);
      }
      download(
        `${stem}.json`,
        'application/json',
        JSON.stringify({ seed: world.initialParams.seed, tick: world.tick, hash: world.stateHash(), params: world.params, samples }, null, 1),
      );
    } else {
      const lines = [['tick', ...METRIC_COLUMNS].join(',')];
      for (let i = 0; i < n; i++) lines.push([metrics.tick[i], ...METRIC_COLUMNS.map((c) => metrics.series[c][i])].join(','));
      download(`${stem}.csv`, 'text/csv', lines.join('\n'));
    }
    say(`exported ${n} samples as ${asJson ? 'json' : 'csv'}`);
  }

  csvBtn?.addEventListener('click', () => exportSamples(host.metrics(), false));
  jsonBtn?.addEventListener('click', () => exportSamples(host.metrics(), true));

  let lastAutosave = 0;
  function maybeAutosave(now: number): void {
    if (now - lastAutosave < AUTOSAVE_MS) return;
    lastAutosave = now;
    const world = host.getWorld();
    if (world.tick === 0) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, encodeRun(world));
    } catch {
      // storage full or private mode: the run keeps going, and the share link still works
    }
  }

  refreshSlots();

  // A `?run=` link wins over autosave. An explicit `?seed=` also wins: asking for a seed means asking
  // for that seed's fresh world, and silently dropping the visitor into somebody's last run would be
  // a surprise they cannot explain.
  const query = new URLSearchParams(location.search);
  const urlRun = query.get('run');
  if (urlRun) {
    restore(urlRun, 'share link');
  } else if (!query.has('seed')) {
    let autosaved: string | null = null;
    try {
      autosaved = localStorage.getItem(AUTOSAVE_KEY);
    } catch {
      autosaved = null;
    }
    if (autosaved) restore(autosaved, 'autosave');
  }

  return { maybeAutosave, restoredFrom: () => restoredFrom };
}
