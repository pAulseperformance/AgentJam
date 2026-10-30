import { describe, it, expect } from 'vitest';
import {
  keepNewest, prunePast, renderBudget, renderStride, takeForBar, RENDER_COST_ASSUMED_MS,
  barDelayMs, barMsFor, barElapsedEnough, firstReachableBar, DEFAULT_BAR_MS, MAX_BPM, MIN_BPM,
  MIN_BAR_MS,
} from './bar-queue';

type Entry = { bar: number };

describe('prunePast', () => {
  it('drops a bar that has already gone and keeps the next two', () => {
    const q: Entry[] = [{ bar: 4 }, { bar: 5 }, { bar: 6 }];
    expect(prunePast(q, 5)).toEqual([{ bar: 5 }, { bar: 6 }]);
  });

  it('keeps the bar that is due now, so a render that just made it still plays', () => {
    expect(prunePast([{ bar: 7 }], 7)).toEqual([{ bar: 7 }]);
  });
});

describe('keepNewest', () => {
  it('keeps the later bars, not the lower ones', () => {
    // The live bug in one assertion: ascending sort + slice(0, 2) kept 5 and 6 and threw away 8.
    const q: Entry[] = [{ bar: 5 }, { bar: 6 }, { bar: 8 }];
    expect(keepNewest(q, 2)).toEqual([{ bar: 6 }, { bar: 8 }]);
  });

  it('returns ascending, so queue[0] is the next bar for the refresh check', () => {
    expect(keepNewest([{ bar: 9 }, { bar: 8 }], 2)).toEqual([{ bar: 8 }, { bar: 9 }]);
  });
});

describe('takeForBar', () => {
  it('publishes only the entry written for this bar', () => {
    const q: Entry[] = [{ bar: 5 }, { bar: 6 }];
    const { ready, rest } = takeForBar(q, 6);
    expect(ready).toEqual({ bar: 6 });
    expect(rest).toEqual([{ bar: 5 }]);
  });

  it('never shifts a stale bar into the present', () => {
    const { ready, rest } = takeForBar([{ bar: 4 }], 6);
    expect(ready).toBeNull();
    expect(rest).toEqual([{ bar: 4 }]);
  });
});

describe('renderBudget', () => {
  it('is the time left in the bar, less a margin', () => {
    expect(renderBudget(1500, 2500)).toBe(1400);
  });

  it('never exceeds the max, so a long bar still uses the old ceiling', () => {
    expect(renderBudget(9000, 2500)).toBe(2500);
  });

  it('floors at 400 so a call that is already late still gets a chance', () => {
    expect(renderBudget(200, 2500)).toBe(400);
  });
});

describe('a 160 BPM session where one render in seven overruns its bar', () => {
  // The shape of the 2026-10-30 recording: 53 bars, 1500ms each, a Jev decision plus a model call that
  // usually fits and sometimes does not. The render is serialised by `agent.busy`, so an overrun also
  // costs the bar after it.
  const BARS = 53;

  function simulate(policy: 'old' | 'new') {
    let queue: Entry[] = [];
    let pending: Array<{ bar: number; landsAt: number }> = [];
    let busyUntil = -1;
    const published: number[] = [];
    const attempted: number[] = [];

    for (let bar = 0; bar < BARS; bar++) {
      const landed = pending.filter(p => p.landsAt <= bar);
      pending = pending.filter(p => p.landsAt > bar);
      for (const p of landed) queue.push({ bar: p.bar });

      if (policy === 'new') queue = prunePast(queue, bar);
      const claimed = takeForBar(queue, bar);
      queue = claimed.rest;
      if (claimed.ready) published.push(bar);

      queue = policy === 'old'
        ? [...queue].sort((a, b) => a.bar - b.bar).slice(0, 2)
        : keepNewest(queue, 2);

      if (bar > busyUntil && queue.length < 2) {
        attempted.push(bar);
        const late = bar % 7 === 3 ? 1 : 0;
        pending.push({ bar: bar + 1, landsAt: bar + 1 + late });
        busyUntil = bar + late;
      }
    }
    return { published, attempted };
  }

  it('locks up under the old trim, and the band goes silent for the rest of the session', () => {
    const { published, attempted } = simulate('old');
    expect(published.length).toBeLessThan(13);
    expect(Math.max(...published)).toBeLessThan(20);
    expect(attempted.length).toBeLessThan(13);
    expect(attempted).not.toContain(52);
  });

  it('keeps rendering under the new trim, and still speaks late in the session', () => {
    const { published, attempted } = simulate('new');
    expect(published.length).toBeGreaterThanOrEqual(25);
    expect(published.some(b => b >= 45)).toBe(true);
    expect(attempted).toContain(52);
  });

  it('costs only the overrun bars, not everything after them', () => {
    const { published } = simulate('new');
    const late = Math.floor(BARS / 7);          // 7 overruns
    expect(published.length).toBeGreaterThanOrEqual(BARS - late * 2 - 2);
  });
});

describe('renderStride', () => {
  const barMs = (bpm: number) => 240_000 / bpm;
  const cost = RENDER_COST_ASSUMED_MS;      // 1300 ms, the worst observed call

  it('writes every bar while a render fits inside one', () => {
    expect(renderStride(cost, barMs(120))).toBe(1);
    expect(renderStride(cost, barMs(160))).toBe(1);
    expect(renderStride(cost, barMs(170))).toBe(1);   // 1412 ms bar against 1400 ms of work
  });

  it('moves out to every second bar above the ceiling', () => {
    expect(renderStride(cost, barMs(175))).toBe(2);
    expect(renderStride(cost, barMs(200))).toBe(2);
    expect(renderStride(cost, barMs(240))).toBe(2);
    expect(renderStride(cost, barMs(300))).toBe(2);
  });

  it('lets a fast agent keep a fast room: half the cost doubles the ceiling', () => {
    expect(renderStride(650, barMs(200))).toBe(1);
    expect(renderStride(650, barMs(300))).toBe(1);
  });

  it('holds the phrase rate in real time, rather than letting it collapse as the tempo rises', () => {
    for (const bpm of [160, 175, 200, 240, 300]) {
      const stride = renderStride(cost, barMs(bpm));
      const msPerWrittenBar = stride * barMs(bpm);
      // The stride is a step function, so the rate is never below the requirement and never more
      // than one wasted bar above it: stride*bar <= (cost + margin) + bar.
      expect(msPerWrittenBar).toBeGreaterThanOrEqual(cost);
      expect(msPerWrittenBar).toBeLessThan(cost + 100 + barMs(bpm));
    }
  });

  it('degenerates safely on a nonsense tempo', () => {
    expect(renderStride(cost, 0)).toBe(1);
    expect(renderStride(0, barMs(200))).toBe(1);
  });
});

describe('barMsFor', () => {
  const bar = (bpm: number) => 240_000 / bpm;

  it('gives the width of a bar for a tempo the protocol allows', () => {
    expect(barMsFor(120)).toBe(2000);
    expect(barMsFor(MIN_BPM)).toBe(bar(MIN_BPM));
    expect(barMsFor(MAX_BPM)).toBe(bar(MAX_BPM));
  });

  it('refuses a tempo that describes no bar at all', () => {
    expect(barMsFor(Number.NaN)).toBeNull();
    expect(barMsFor(0)).toBeNull();
    expect(barMsFor(-5)).toBeNull();
    expect(barMsFor(Number.POSITIVE_INFINITY)).toBeNull();
    expect(barMsFor(1_000_000)).toBeNull();     // 0.24 ms, below MIN_BAR_MS
  });

  it('keeps every allowed bar above the floor', () => {
    expect(bar(MAX_BPM)).toBeGreaterThanOrEqual(MIN_BAR_MS);
    expect(DEFAULT_BAR_MS).toBe(bar(120));
  });
});

describe('barDelayMs', () => {
  const start = 1_700_000_000_000;

  it('waits for the next line, never 0 and never more than a bar', () => {
    const wait = barDelayMs(start, 115, start + 700);
    expect(wait).toBeCloseTo(2086.9565217391304 - 700, 3);
    expect(wait).toBeGreaterThanOrEqual(1);
  });

  it('waits a whole bar when the clock sits exactly on a line', () => {
    expect(barDelayMs(start, 120, start + 2000)).toBe(2000);
  });

  it('never hands setTimeout a zero, which is the loop', () => {
    // The old inline arithmetic is reproduced here: it returned NaN, Infinity or a clamped 0 for a
    // grid it could not compute, and Workers fires all three at once.
    const oldWait = (bpm: number, now: number) => {
      const bar = (60 / bpm) * 4 * 1000;
      return Math.max(0, start + (Math.floor((now - start) / bar) + 1) * bar - now);
    };
    for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      const old = oldWait(bad, start);
      expect(Number.isFinite(old) && old > 0).toBe(false);   // NaN, Infinity, or 0: all fire at once
      expect(barDelayMs(start, bad, start)).toBeNull();
    }
  });

  it('refuses a transport that cannot be computed', () => {
    expect(barDelayMs(Number.NaN, 120, start)).toBeNull();
    expect(barDelayMs(start, Number.NaN, start)).toBeNull();
  });
});

describe('barElapsedEnough', () => {
  it('allows the first bar of a session', () => {
    expect(barElapsedEnough(0, 5_000, 2000)).toBe(true);
  });

  it('refuses a second announcement inside a bar', () => {
    expect(barElapsedEnough(1_000_000, 1_000_400, 2000)).toBe(false);
    expect(barElapsedEnough(1_000_000, 1_001_500, 2000)).toBe(false);
  });

  it('allows the next bar line and anything later', () => {
    expect(barElapsedEnough(1_000_000, 1_002_000, 2000)).toBe(true);
    expect(barElapsedEnough(1_000_000, 1_010_000, 2000)).toBe(true);
  });

  it('replays the 2026-10-30 storm: 269 announcements inside 2.6 s become at most 2', () => {
    // Bar length 2087 ms at 115 BPM, and the recording's 269 arrivals spaced 9.7 ms apart.
    let last = 0; let accepted = 0;
    for (let i = 0; i < 269; i++) {
      const now = 20_074 + i * 9.7;
      if (barElapsedEnough(last, now, 2086.95)) { accepted++; last = now; }
    }
    expect(accepted).toBeLessThanOrEqual(2);
  });
});

describe('firstReachableBar', () => {
  const start = 1_700_000_000_000;
  const barMs = (bpm: number) => 240_000 / bpm;

  it('leaves the target alone when there is a whole bar of room', () => {
    // 80 BPM: a bar is 3000 ms, and a render costs about 1400 ms, so bar 1 is reachable from the top.
    expect(firstReachableBar(start, barMs(80), 1, start + 100, 1400)).toBe(1);
  });

  it('moves out when the spawn inherited the remainder of a bar', () => {
    // The measured cold start: 2226 ms into an 80 BPM bar, so 774 ms to the next line.
    expect(firstReachableBar(start, barMs(80), 1, start + 2226, 1400)).toBe(2);
  });

  it('moves out at a tempo where one bar cannot hold a render', () => {
    // 200 BPM: 1200 ms bars, so the first line is too close and the second is just enough.
    expect(firstReachableBar(start, barMs(200), 1, start + 10, 1400)).toBe(2);
  });

  it('is bounded, so a wrong clock cannot walk the bar number away', () => {
    expect(firstReachableBar(start, barMs(80), 1, start, 1_000_000)).toBe(5);
  });

  it('refuses to guess on a grid it cannot compute', () => {
    expect(firstReachableBar(Number.NaN, barMs(80), 1, start, 1400)).toBe(1);
    expect(firstReachableBar(start, Number.NaN, 1, start, 1400)).toBe(1);
  });
});
