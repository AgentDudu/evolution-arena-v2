// Share and replay. A run is fully described by (seed, params, ticks, events), so that is what a
// share link carries, and the viewer rebuilds it by ticking the same World the sender ticked.
// Nothing here re-implements sim behaviour: `applyEvent` calls the same World methods the live
// sandbox tools call, which is the only reason a matching state hash means anything.

import { CONFIG_VERSION, DEFAULT_PARAMS, GENES, validateParams, type SimParams } from '../core/config.ts';
import type { Seed } from '../core/rng.ts';
import { World, type WorldEvent } from './world.ts';

export const SHARE_VERSION = 1;
/** Replay is the ordinary sim: a browser tab manages a few hundred ticks a second, so a link asking
 *  for a million ticks would lock the page for an hour. The cap is reported, not applied silently. */
export const MAX_REPLAY_TICKS = 60_000;
export const MAX_EVENTS = 2_000;
/** Links longer than this stop surviving chat clients, so say so instead of handing out a broken URL. */
export const MAX_SHARE_CHARS = 6_000;

export interface RunState {
  version: number;
  seed: Seed;
  /** Only the params that differ from this build's defaults travel; the rest are implied. */
  params: Partial<SimParams>;
  tick: number;
  hash: number;
  events: WorldEvent[];
}

const EVENT_KINDS = ['food', 'release', 'delete', 'foodBloom', 'catastrophe', 'mutationBurst', 'params'] as const;
const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isScalar = (v: unknown): v is number | boolean | string =>
  typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padding = '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The whole run as one URL-safe string, ready for `?run=`. The params are the ones the world *started*
 *  with: a mid-run edit is an event, and encoding the live params would move it to tick 0. */
export function encodeRun(world: World): string {
  const params: Record<string, unknown> = {};
  for (const key of PARAM_KEYS) {
    const value = world.initialParams[key as keyof SimParams];
    // `seed` travels as a top-level field, so it is not repeated here
    if (key !== 'seed' && value !== DEFAULT_PARAMS[key as keyof SimParams]) params[key] = value;
  }
  const compact = {
    v: SHARE_VERSION,
    cv: CONFIG_VERSION,
    seed: world.initialParams.seed,
    t: world.tick,
    h: world.stateHash(),
    p: params,
    e: world.events.map((ev) => [ev.tick, ev.kind, ev.x, ev.y, ev.value, ev.patch, ev.genes]),
  };
  return toBase64Url(JSON.stringify(compact));
}

/** `?run=` for the current page. Saved slots and autosave have no length limit; a URL does, because
 *  chat clients and bookmark bars quietly truncate long ones - so the limit is an error, not a truncation. */
export function shareLink(world: World, base = location.href.split('?')[0]): string {
  const payload = encodeRun(world);
  if (payload.length > MAX_SHARE_CHARS) {
    throw new Error(
      `this run needs ${payload.length} chars of link for ${world.events.length} events (a link carries about ${MAX_SHARE_CHARS}) - save it in a slot instead`,
    );
  }
  return `${base}?run=${payload}`;
}

/** A param object from an untrusted link: known keys only, then the same validator the world is
 *  constructed with, so a link cannot invent a world this build refuses to run. */
function pickParams(input: unknown): Record<string, number | boolean | string> {
  if (typeof input !== 'object' || input === null) throw new Error('share link has no params');
  const out: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PARAM_KEYS.includes(key)) throw new Error(`share link sets unknown param ${key}`);
    if (!isScalar(value)) throw new Error(`share link param ${key} is not a number, boolean or string`);
    out[key] = value;
  }
  return out;
}

function pickGenes(input: unknown): Record<string, number> {
  if (typeof input !== 'object' || input === null) throw new Error('share link release has no genome');
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!GENE_NAMES.includes(key as (typeof GENE_NAMES)[number])) throw new Error(`share link release sets unknown gene ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`share link gene ${key} is not a number`);
    out[key] = value;
  }
  return out;
}

const GENE_NAMES = Object.keys(GENES);

function decodeEvents(input: unknown): WorldEvent[] {
  if (!Array.isArray(input)) throw new Error('share link has no event list');
  if (input.length > MAX_EVENTS) throw new Error(`share link has ${input.length} events; limit is ${MAX_EVENTS}`);
  let previous = -1;
  return input.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) throw new Error('malformed event in share link');
    // JSON turns the omitted tail of a tuple into null, so absent has to mean absent again
    const norm = (v: unknown) => (v === null ? undefined : v);
    const [tick, kind, x0, y0, v0, patch0, genes0] = entry as unknown[];
    const x = norm(x0);
    const y = norm(y0);
    const value = norm(v0);
    const patch = norm(patch0);
    const genes = norm(genes0);
    if (!isInt(tick) || tick < 0) throw new Error('event with a bad tick');
    if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as (typeof EVENT_KINDS)[number])) {
      throw new Error(`unknown event ${String(kind)} in share link`);
    }
    for (const n of [x, y, value]) if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) {
      throw new Error(`event ${kind} with a non-numeric field`);
    }
    if (tick < previous) throw new Error('events out of order in share link');
    previous = tick;
    return {
      tick,
      kind: kind as WorldEvent['kind'],
      x: x as number | undefined,
      y: y as number | undefined,
      value: value as number | undefined,
      patch: kind === 'params' ? (pickParams(patch) as Partial<SimParams>) : undefined,
      genes: kind === 'release' ? (pickGenes(genes) as WorldEvent['genes']) : undefined,
    };
  });
}

/** Read a share string back, refusing anything this build would not run. */
export function decodeRun(text: string): RunState {
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(text.trim()));
  } catch {
    throw new Error('share link is not readable');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('share link is not readable');
  const r = raw as { v?: unknown; cv?: unknown; seed?: unknown; t?: unknown; h?: unknown; p?: unknown; e?: unknown };
  if (r.v !== SHARE_VERSION) throw new Error(`share link v${String(r.v)} is not v${SHARE_VERSION}`);
  if (r.cv !== CONFIG_VERSION) {
    throw new Error(`share link came from sim config v${String(r.cv)}, this build is v${CONFIG_VERSION}: the rules changed, so it cannot replay`);
  }
  const seed = r.seed;
  if (typeof seed !== 'string' && typeof seed !== 'number') throw new Error('share link has no seed');
  if (typeof seed === 'string' && seed.length > 64) throw new Error('share link seed is too long');
  if (!isInt(r.t) || (r.t as number) < 0) throw new Error('share link has a bad tick count');
  if ((r.t as number) > MAX_REPLAY_TICKS) {
    throw new Error(`share link replays ${String(r.t)} ticks; the cap is ${MAX_REPLAY_TICKS} (a link replays the sim live, in this tab)`);
  }
  if (typeof r.h !== 'number') throw new Error('share link has no state hash');
  const params = pickParams(r.p);
  validateParams({ ...DEFAULT_PARAMS, ...params, seed } as SimParams);
  const events = decodeEvents(r.e);
  const last = events[events.length - 1];
  if (last && last.tick > (r.t as number)) throw new Error('share link has an event after the run ends');
  return {
    version: SHARE_VERSION,
    seed,
    params: params as Partial<SimParams>,
    tick: r.t as number,
    hash: r.h,
    events,
  };
}

/** Apply one logged event. The live tools call these same World methods, so replay cannot drift
 *  away from what the sender actually did. */
export function applyEvent(world: World, ev: WorldEvent): void {
  switch (ev.kind) {
    case 'food':
      world.scatterFood(ev.x ?? 0, ev.y ?? 0, ev.value ?? 8);
      break;
    case 'release':
      world.releaseCluster(ev.x ?? 0, ev.y ?? 0, ev.value ?? 1, ev.genes ?? {});
      break;
    case 'delete':
      world.deleteAt(ev.value ?? -1);
      break;
    case 'foodBloom':
      world.foodBloom(ev.value);
      break;
    case 'catastrophe':
      world.catastrophe(ev.value);
      break;
    case 'mutationBurst':
      world.mutationBurst();
      break;
    case 'params':
      world.setParams(ev.patch ?? {});
      break;
  }
}

/** Rebuild a shared run. A generator so the page can spend a frame budget at a time and paint the
 *  fast-forward instead of freezing the tab; it returns the world at the sender's tick. */
export function* replayRun(run: RunState): Generator<number, World, void> {
  const world = new World({ ...DEFAULT_PARAMS, ...run.params, seed: run.seed });
  for (const ev of run.events) {
    while (world.tick < ev.tick) {
      world.step();
      yield world.tick;
    }
    applyEvent(world, ev);
  }
  while (world.tick < run.tick) {
    world.step();
    yield world.tick;
  }
  return world;
}
