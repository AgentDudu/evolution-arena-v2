// Instant restore for autosave and named slots (work item 7).
//
// The replay format (share.ts) is the small, human-checkable one: seed + starting params + event log,
// rebuilt by ticking. That is what makes a share link worth reading, but it costs a tick per tick, so a
// save taken at tick 30 000 costs minutes to open. A snapshot writes the live arrays instead, so the
// same save loads in milliseconds. Share links deliberately stay on the replay format: they have to fit
// in a URL and a reader can tell what they promise.
//
// A snapshot is refused unless the world it rebuilds hashes to the hash recorded when it was written, so
// a truncated or hand-edited save says so instead of loading a subtly different run.

import { validateParams, type SimParams } from '../core/config.ts';
import type { Seed } from '../core/rng.ts';
import type { HistoryState } from './history.ts';
import { METRIC_COLUMNS } from './history.ts';
import { World } from './world.ts';
import type { WorldEvent } from './world.ts';

export const SNAPSHOT_PREFIX = 'EA2:';
export const SNAPSHOT_VERSION = 2;

export type SnapshotArray = Float64Array | Int32Array | Uint8Array;

/** The decoded form, which `World.adoptState` consumes. Arrays are the live prefix only: everything
 *  past `alive` / `food` is dead capacity. Version and hash live in the wire format, not here: they are
 *  checks on the bytes, not part of a world. */
export interface SnapshotState {
  tick: number;
  seed: Seed;
  /** The params the run started with, so a restored world can still produce a share link. */
  start: SimParams;
  /** The params in force at the saved tick (mid-run slider edits). */
  params: SimParams;
  events: WorldEvent[];
  alive: number;
  food: number;
  nextLineage: number;
  foodAcc: number;
  rng: number[];
  org: Record<string, SnapshotArray>;
  foodArrays: Record<string, Float64Array>;
}

function toBase64(arr: SnapshotArray): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let text = '';
  // 32k per call: String.fromCharCode with the whole array as arguments blows the argument limit on a
  // full arena, and a byte-at-a-time loop is needlessly slow.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string, kind: string): SnapshotArray {
  const Ctor = kind === 'lineage' ? Int32Array : kind === 'origin' ? Uint8Array : Float64Array;
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Ctor(bytes.buffer);
}

/** Compact string for localStorage. Around 0.4 MB for a full arena, which is why it stays out of URLs.
 *  `history` is the sampled graph series of the same run: a save that comes back with empty charts is a
 *  save that lost half of what the viewer was looking at. Optional, and left out of share links. */
export function encodeSnapshot(world: World, history?: { saveState(): HistoryState; length: number }): string {
  const s = world.saveState();
  const org: Record<string, string> = {};
  for (const [key, arr] of Object.entries(s.org)) org[key] = toBase64(arr);
  const food: Record<string, string> = {};
  for (const [key, arr] of Object.entries(s.foodArrays)) food[key] = toBase64(arr);
  let hist: { stride: number; length: number; cols: Record<string, string> } | undefined;
  if (history !== undefined && history.length > 0) {
    const hs = history.saveState();
    const cols: Record<string, string> = { tick: toBase64(hs.tick) };
    for (const [key, arr] of Object.entries(hs.series)) cols[key] = toBase64(arr);
    hist = { stride: hs.stride, length: hs.length, cols };
  }
  return `${SNAPSHOT_PREFIX}${JSON.stringify({
    v: SNAPSHOT_VERSION,
    h: world.stateHash(),
    t: s.tick,
    seed: s.seed,
    start: s.start,
    params: s.params,
    events: s.events,
    alive: s.alive,
    food: s.food,
    nextLineage: s.nextLineage,
    foodAcc: s.foodAcc,
    rng: s.rng,
    org,
    foodArrays: food,
    hist,
  })}`;
}

interface WireSnapshot {
  v?: number;
  h?: number;
  t?: number;
  seed?: Seed;
  start?: SimParams;
  params?: SimParams;
  events?: WorldEvent[];
  alive?: number;
  food?: number;
  nextLineage?: number;
  foodAcc?: number;
  rng?: number[];
  org?: Record<string, string>;
  foodArrays?: Record<string, string>;
  hist?: { stride?: number; length?: number; cols?: Record<string, string> };
}

/** The graph series, if the save carries them. Absent on a snapshot written before this existed, which
 *  just means the restored run starts its graphs from the tick it woke up at. Validated here rather than
 *  at adopt time, so a save with half its charts is refused by the same gate that refuses half a world. */
function decodeHistory(wire: WireSnapshot): HistoryState | undefined {
  const hist = wire.hist;
  if (hist === undefined) return undefined;
  const length = Number(hist.length ?? 0);
  if (!Number.isInteger(length) || length < 0) throw new Error(`snapshot claims ${String(hist.length)} graph samples`);
  const cols: Record<string, Float64Array> = {};
  for (const [key, packed] of Object.entries(hist.cols ?? {})) cols[key] = fromBase64(packed, key) as Float64Array;
  for (const name of ['tick', ...METRIC_COLUMNS]) {
    if (cols[name] === undefined || cols[name].length !== length) {
      throw new Error(`snapshot's graph column ${name} holds ${String(cols[name]?.length)}, expected ${String(length)}`);
    }
  }
  return {
    stride: Number(hist.stride ?? 15),
    length,
    tick: cols['tick'],
    series: cols as HistoryState['series'],
  };
}

/** Parse and validate, then rebuild the world. Throws with a message a person can act on. */
export function worldFromSnapshot(text: string): { world: World; savedHash: number; history?: HistoryState } {
  if (!text.startsWith(SNAPSHOT_PREFIX)) throw new Error('not a snapshot');
  let wire: WireSnapshot;
  try {
    wire = JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as WireSnapshot;
  } catch {
    throw new Error('snapshot is unreadable (truncated or edited)');
  }
  if (wire.v !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot came from another version of the page (wrote ${String(wire.v)}, this build reads ${SNAPSHOT_VERSION})`);
  }
  const start = wire.start;
  const params = wire.params;
  const alive = wire.alive;
  if (start === undefined || params === undefined || wire.org === undefined || wire.foodArrays === undefined) {
    throw new Error('snapshot is missing part of the run (params, live params, organism or food arrays)');
  }
  if (typeof alive !== 'number' || !Number.isInteger(alive) || alive < 0 || alive > start.maxOrganisms) {
    throw new Error(`snapshot claims ${String(alive)} organisms, which does not fit a world built for ${start.maxOrganisms}`);
  }
  const foodCount = wire.food;
  if (typeof foodCount !== 'number' || !Number.isInteger(foodCount) || foodCount < 0 || foodCount > start.foodCap) {
    throw new Error(`snapshot claims ${String(foodCount)} food particles, above this world's cap of ${start.foodCap}`);
  }
  try {
    validateParams(start);
  } catch (error) {
    throw new Error(`snapshot's starting parameters are not valid: ${String((error as Error).message).split('\n')[0]}`);
  }

  const org: Record<string, SnapshotArray> = {};
  for (const [key, packed] of Object.entries(wire.org)) org[key] = fromBase64(packed, key);
  const foodArrays: Record<string, Float64Array> = {};
  for (const [key, packed] of Object.entries(wire.foodArrays)) foodArrays[key] = fromBase64(packed, key) as Float64Array;

  const world = new World(start, wire.seed ?? start.seed);
  world.adoptState({
    tick: Number(wire.t ?? 0),
    seed: wire.seed ?? start.seed,
    start,
    params,
    events: wire.events ?? [],
    alive,
    food: foodCount,
    nextLineage: Number(wire.nextLineage ?? 1),
    foodAcc: Number(wire.foodAcc ?? 0),
    rng: wire.rng ?? [],
    org,
    foodArrays,
  });

  const savedHash = Number(wire.h ?? -1);
  if (world.stateHash() !== savedHash) {
    throw new Error(`snapshot rebuilt a different world (saved hash ${String(savedHash)}, this build ${String(world.stateHash())})`);
  }
  return { world, savedHash, history: decodeHistory(wire) };
}
