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

/** Compact string for localStorage. Around 0.4 MB for a full arena, which is why it stays out of URLs. */
export function encodeSnapshot(world: World): string {
  const s = world.saveState();
  const org: Record<string, string> = {};
  for (const [key, arr] of Object.entries(s.org)) org[key] = toBase64(arr);
  const food: Record<string, string> = {};
  for (const [key, arr] of Object.entries(s.foodArrays)) food[key] = toBase64(arr);
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
}

/** Parse and validate, then rebuild the world. Throws with a message a person can act on. */
export function worldFromSnapshot(text: string): { world: World; savedHash: number } {
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
  return { world, savedHash };
}
