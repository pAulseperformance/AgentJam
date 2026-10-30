import { describe, it, expect } from 'vitest';
import { keepNewest, prunePast, renderBudget, takeForBar } from './bar-queue';

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
