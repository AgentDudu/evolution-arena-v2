// Work item 7's second half: autosave and named slots restore instantly by carrying the world, instead
// of rebuilding it tick by tick like a share link does. The bar is not "looks similar" — a snapshot has to
// bring back the same run *and its future*, and refuse anything that does not hash to what was written.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/core/config.ts';
import { METRIC_COLUMNS, MetricsHistory } from '../src/sim/history.ts';
import { encodeSnapshot, SNAPSHOT_PREFIX, worldFromSnapshot } from '../src/sim/snapshot.ts';
import { decodeRun, encodeRun, replayRun, shareLink } from '../src/sim/share.ts';
import { World } from '../src/sim/world.ts';

/** A run touched by every tool and a mid-run slider edit, built the way the live page builds one. */
function scriptedRun(seed: string, ticks: number, history?: MetricsHistory): World {
  const world = new World({ ...DEFAULT_PARAMS, seed });
  // Sampling belongs to the ticking, exactly as it does on the page: the graphs are a record of the run
  // as it happened, not something you can compute afterwards from the final state.
  const step = (): void => {
    world.step();
    if (history !== undefined && world.tick - history.lastTick >= history.stride) history.sample(world.report());
  };
  while (world.tick < 60) step();
  world.scatterFood(220, 140, 10);
  world.releaseCluster(300, 260, 8, { senseRadius: 95, radius: 12 });
  while (world.tick < 200) step();
  world.foodBloom(80);
  world.setParams({ foodPerTick: 4, predationRatio: 1.6 });
  while (world.tick < 320) step();
  world.catastrophe(0.35);
  world.mutationBurst();
  while (world.tick < ticks) step();
  return world;
}

describe('snapshot round-trip', () => {
  it('writes the world itself, and reading it back needs no replay', () => {
    const world = scriptedRun('snap', 400);
    const text = encodeSnapshot(world);
    expect(text.startsWith(SNAPSHOT_PREFIX)).toBe(true);

    const { world: loaded, savedHash } = worldFromSnapshot(text);
    expect(savedHash).toBe(world.stateHash());
    expect(loaded.tick).toBe(world.tick);
    expect(loaded.alive).toBe(world.alive);
    expect(loaded.foodCount).toBe(world.foodCount);
    expect(loaded.stateHash()).toBe(world.stateHash());
    expect(loaded.params).toEqual(world.params);
    // The starting params stay the starting params, so a later share link still means the same run.
    expect(loaded.initialParams).toEqual(world.initialParams);
    expect(loaded.events.length).toBe(world.events.length);
  });

  it('keeps the future of the run, not only its saved tick', () => {
    // The part a state hash cannot see: the rng stream position, the food pacing accumulator and the
    // lineage counter. Miss any of them and the saved tick matches while every tick after it drifts.
    const world = scriptedRun('future', 400);
    const { world: loaded } = worldFromSnapshot(encodeSnapshot(world));
    for (let i = 0; i < 300; i++) {
      world.step();
      loaded.step();
    }
    expect(loaded.stateHash()).toBe(world.stateHash());
    expect(loaded.tick).toBe(world.tick);
    expect(loaded.alive).toBe(world.alive);
  });

  it('carries the fields the state hash does not cover', () => {
    const world = scriptedRun('fields', 400);
    const engineered = [...Array(world.alive).keys()].filter((i) => world.origin[i] === 1);
    expect(engineered.length).toBeGreaterThan(0);
    const bigFood = [...Array(world.foodCount).keys()].filter((j) => world.fr[j] > 4);
    expect(bigFood.length).toBeGreaterThan(0);

    const { world: loaded } = worldFromSnapshot(encodeSnapshot(world));
    for (const i of engineered) expect(loaded.origin[i]).toBe(1);
    for (const j of bigFood) expect(loaded.fr[j]).toBe(world.fr[j]);
    for (let i = 0; i < world.alive; i++) expect(loaded.gene.hue[i]).toBe(world.gene.hue[i]);
  });

  it('leaves a restored run shareable', () => {
    const world = scriptedRun('share-after-load', 400);
    const { world: loaded } = worldFromSnapshot(encodeSnapshot(world));
    // shareLink describes the run the snapshot came from: replaying that link lands on the same hash.
    const link = new URL(shareLink(loaded, 'https://arena.test/'));
    const it = replayRun(decodeRun(link.searchParams.get('run') ?? ''));
    let result = it.next();
    while (!result.done) result = it.next();
    expect(result.value.stateHash()).toBe(loaded.stateHash());
  });

  it('refuses text that is not a snapshot', () => {
    expect(() => worldFromSnapshot('EA1:hello')).toThrow(/not a snapshot/);
    expect(() => worldFromSnapshot('{"v":2}')).toThrow(/not a snapshot/);
  });

  it('refuses a snapshot from another version of the page', () => {
    const text = encodeSnapshot(scriptedRun('version', 120));
    const bumped = text.replace('"v":2', '"v":99');
    expect(bumped).not.toBe(text);
    expect(() => worldFromSnapshot(bumped)).toThrow(/another version of the page/);
  });

  it('refuses a truncated payload instead of loading half a world', () => {
    const text = encodeSnapshot(scriptedRun('truncated', 200));
    expect(() => worldFromSnapshot(text.slice(0, text.length / 2))).toThrow(/unreadable|unknown organism array|different world/);
  });

  it('refuses counts that do not fit the world the params describe', () => {
    const text = encodeSnapshot(scriptedRun('overflow', 200));
    const body = JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as { alive: number; food: number };
    body.alive = DEFAULT_PARAMS.maxOrganisms + 5;
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(body)}`)).toThrow(/does not fit a world built for/);

    body.alive = 10;
    body.food = DEFAULT_PARAMS.foodCap + 1;
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(body)}`)).toThrow(/food particles/);
  });

  it('refuses a save whose numbers were edited', () => {
    const text = encodeSnapshot(scriptedRun('tamper', 200));
    const wire = JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as { org: Record<string, string> };
    const packed = wire.org.x;
    wire.org.x = packed[40] === 'A' ? `${packed.slice(0, 40)}B${packed.slice(41)}` : `${packed.slice(0, 40)}A${packed.slice(41)}`;
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(wire)}`)).toThrow(/rebuilt a different world/);
  });

  it('refuses a payload that carries an array this build does not know', () => {
    const text = encodeSnapshot(scriptedRun('extra', 200));
    const wire = JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as { org: Record<string, string> };
    wire.org.g_notagene = wire.org.g_hue;
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(wire)}`)).toThrow(/unknown organism array/);
  });
});

describe('the graphs a restore brings back', () => {
  /** Ticked with sampling, the way the live page builds both a world and its charts. */
  function sampledRun(seed: string, ticks: number): { world: World; history: MetricsHistory } {
    const history = new MetricsHistory();
    return { world: scriptedRun(seed, ticks, history), history };
  }

  function columnsEqual(a: MetricsHistory, b: MetricsHistory): boolean {
    if (a.length !== b.length) return false;
    for (const name of METRIC_COLUMNS) {
      for (let i = 0; i < a.length; i++) if (a.series[name][i] !== b.series[name][i]) return false;
    }
    for (let i = 0; i < a.length; i++) if (a.tick[i] !== b.tick[i]) return false;
    return true;
  }

  it('a snapshot carries the sampled series, so the charts are not empty on reopen', () => {
    const { world, history } = sampledRun('snap-graphs', 700);
    expect(history.length).toBeGreaterThan(10);

    const text = encodeSnapshot(world, history);
    const loaded = worldFromSnapshot(text);
    expect(loaded.history).toBeDefined();

    const restored = new MetricsHistory();
    restored.adoptState(loaded.history!);
    expect(restored.length).toBe(history.length);
    expect(restored.stride).toBe(history.stride);
    expect(restored.lastTick).toBe(history.tick[history.length - 1]);
    // Float64 in, Float64 out: a graph restored at 0.9999 of its values is a graph quietly redrawn.
    expect(columnsEqual(restored, history)).toBe(true);

    // and the run keeps sampling on top of what it had, instead of starting a second series at tick 700
    const before = restored.length;
    let report = loaded.world.report();
    while (report.tick - restored.lastTick < restored.stride) {
      loaded.world.step();
      report = loaded.world.report();
    }
    expect(restored.sample(report)).toBe(true);
    expect(restored.length).toBe(before + 1);
    expect(restored.tick[before]).toBe(report.tick);
  });

  it('refuses a save whose graph columns do not agree with their own header', () => {
    const { world, history } = sampledRun('snap-graph-cut', 400);
    const text = encodeSnapshot(world, history);
    const body = () => JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as { hist: { length: number; cols: Record<string, string> } };

    const wire = body();
    wire.hist.length -= 1; // header says one sample fewer than the columns hold
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(wire)}`)).toThrow(/graph column tick holds/);

    const cut = body();
    cut.hist.cols.pop = cut.hist.cols.pop.slice(0, -8); // a column missing bytes mid-value
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(cut)}`)).toThrow();

    const missing = body();
    delete missing.hist.cols.energy;
    expect(() => worldFromSnapshot(`${SNAPSHOT_PREFIX}${JSON.stringify(missing)}`)).toThrow(/graph column energy/);
  });

  it('a replayed run gets the same charts the live run drew', () => {
    const { world, history } = sampledRun('replay-graphs', 600);
    const run = decodeRun(encodeRun(world));
    const series = new MetricsHistory();
    const it = replayRun(run, series);
    let rebuilt;
    for (;;) {
      const next = it.next();
      if (next.done) {
        rebuilt = next.value;
        break;
      }
    }
    expect(rebuilt.stateHash()).toBe(world.stateHash());
    expect(series.length).toBe(history.length);
    expect(columnsEqual(series, history)).toBe(true);
  });

  it('a save without a history section still loads, and simply starts its charts fresh', () => {
    const { world, history } = sampledRun('no-hist', 300);
    const text = encodeSnapshot(world); // the panel could not have sampled a world it did not run
    const loaded = worldFromSnapshot(text);
    expect(loaded.world.stateHash()).toBe(world.stateHash());
    expect(loaded.history).toBeUndefined();
    const fresh = new MetricsHistory();
    expect(fresh.length).toBe(0);
    expect(history.length).toBeGreaterThan(0);
  });
});
