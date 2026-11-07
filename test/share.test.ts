// Work item 7's done-when: "a share link reproduces the sender's state hash at its tick count".
// These tests are the proof, plus the validation an untrusted link has to fail.

import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION, DEFAULT_PARAMS } from '../src/core/config.ts';
import { decodeRun, encodeRun, replayRun, SHARE_VERSION } from '../src/sim/share.ts';
import { World } from '../src/sim/world.ts';

const seedOf = (s: string) => s;

/** A run touched by every tool and event, recorded as it happens, exactly like the live page does. */
function scriptedRun(seed: string, ticks: number) {
  const world = new World({ ...DEFAULT_PARAMS, seed: seedOf(seed) });
  for (const at of [60, 140, 220, 300, 380, 460, 540]) {
    while (world.tick < at) world.step();
    switch (at) {
      case 60:
        world.scatterFood(220, 140, 10);
        break;
      case 140:
        world.releaseCluster(300, 260, 8, { senseRadius: 95, radius: 12 });
        break;
      case 220:
        world.foodBloom(80);
        break;
      case 300:
        world.catastrophe(0.35);
        break;
      case 380:
        world.setParams({ foodPerTick: 4, predationRatio: 1.6 });
        break;
      case 460:
        world.mutationBurst();
        break;
      default:
        world.deleteAt(world.alive - 1);
    }
  }
  while (world.tick < ticks) world.step();
  return world;
}

describe('share link round-trip', () => {
  it('carries the params the run started with, not the ones a mid-run edit moved on', () => {
    expect(7).not.toBe(DEFAULT_PARAMS.foodPerTick);
    const world = new World({ ...DEFAULT_PARAMS, seed: 'rt', foodPerTick: 7 });
    expect(decodeRun(encodeRun(world)).params).toEqual({ foodPerTick: 7 });

    world.setParams({ foodPerTick: 4 });
    const after = decodeRun(encodeRun(world));
    // the table describes the starting world; the edit is an event that replays at its own tick
    expect(after.params).toEqual({ foodPerTick: 7 });
    expect(after.events.map((e) => e.kind)).toEqual(['params']);
    expect(after.events[0].patch).toEqual({ foodPerTick: 4 });
    expect(after.seed).toBe('rt');
  });

  it('keeps the event log, including each event input', () => {
    const world = scriptedRun('events', 600);
    const decoded = decodeRun(encodeRun(world));
    expect(decoded.events.map((e) => e.kind)).toEqual(world.events.map((e) => e.kind));
    // the log stores inputs, so a catastrophe records its fraction and not how many it killed
    expect(decoded.events.find((e) => e.kind === 'catastrophe')?.value).toBe(0.35);
    expect(decoded.events.find((e) => e.kind === 'release')?.genes).toEqual({ senseRadius: 95, radius: 12 });
    expect(decoded.tick).toBe(600);
    expect(decoded.hash).toBe(world.stateHash());
  });
});

describe('replay reproduces the sender', () => {
  it('reaches the same state hash at the same tick count', () => {
    const world = scriptedRun('replay', 1200);
    const run = decodeRun(encodeRun(world));
    const it = replayRun(run);
    let result = it.next();
    while (!result.done) result = it.next();
    const replayed = result.value;

    expect(replayed.tick).toBe(world.tick);
    expect(replayed.stateHash()).toBe(world.stateHash());
    expect(replayed.report().organisms).toBe(world.report().organisms);
    expect(replayed.report().food).toBe(world.report().food);
    expect(replayed.report().engineered).toBe(world.report().engineered);
  });

  it('replays through the worlds own logging, so re-sharing stays valid', () => {
    const world = scriptedRun('reshare', 900);
    const it = replayRun(decodeRun(encodeRun(world)));
    let result = it.next();
    while (!result.done) result = it.next();
    const replayed = result.value;

    expect(replayed.events.map((e) => [e.tick, e.kind, e.value])).toEqual(world.events.map((e) => [e.tick, e.kind, e.value]));
    // a link made from the replayed world lands on the same state again
    const again = decodeRun(encodeRun(replayed));
    expect(again.hash).toBe(world.stateHash());
  });

  it('is sensitive: a different seed replays to a different hash', () => {
    const a = decodeRun(encodeRun(scriptedRun('sensitive-a', 400)));
    const b = decodeRun(encodeRun(scriptedRun('sensitive-b', 400)));
    const run = (r: typeof a) => {
      const it = replayRun(r);
      let out = it.next();
      while (!out.done) out = it.next();
      return out.value.stateHash();
    };
    expect(run(a)).not.toBe(run(b));
  });
});

describe('an untrusted link cannot run this build', () => {
  const encode = (obj: unknown) => btoa(JSON.stringify(obj));

  it('refuses garbage', () => {
    expect(() => decodeRun('not-a-link')).toThrow(/not readable/);
  });

  it('refuses a link from a different sim config', () => {
    expect(() => decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION + 1, seed: 'x', t: 0, h: 0, p: {}, e: [] }))).toThrow(new RegExp(`config v${CONFIG_VERSION + 1}`));
  });

  it('refuses unknown params, unknown genes and unknown events', () => {
    expect(() => decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 0, h: 0, p: { gravity: 4 }, e: [] }))).toThrow(/unknown param gravity/);
    expect(() => {
      decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 5, h: 0, p: {}, e: [[5, 'release', 10, 10, 2, null, { laser: 3 }]] }));
    }).toThrow(/unknown gene laser/);
    expect(() => {
      decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 5, h: 0, p: {}, e: [[5, 'meteor', 10, 10, 2]] }));
    }).toThrow(/unknown event meteor/);
  });

  it('refuses a run too long to replay in a tab, and an event after the run ends', () => {
    expect(() => decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 5_000_000, h: 0, p: {}, e: [] }))).toThrow(/replays 5000000 ticks/);
    expect(() => {
      decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 10, h: 0, p: {}, e: [[50, 'mutationBurst', null, null, 10]] }));
    }).toThrow(/event after the run ends/);
  });

  it('rejects a param patch the validator itself would reject', () => {
    expect(() => decodeRun(encode({ v: SHARE_VERSION, cv: CONFIG_VERSION, seed: 'x', t: 5, h: 0, p: { foodPerTick: -3 }, e: [] }))).toThrow();
  });
});
