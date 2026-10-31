/**
 * THE BAR LOOP, PROVED OVER MANY BARS.
 *
 * Three fixes, each found by reading a recording, and each of them a statement about what happens over
 * MANY bars rather than about one call. Those statements are the properties here:
 *
 *   b019efc  a bar that has gone can no longer lock the agent's queue
 *            -> `prunePast` at the line, `keepNewest` in the trim, `renderBudget` against the bar's width
 *   a47fd0a  one bar announcement per bar
 *            -> `barDelayMs` never hands `setTimeout` a 0 or a NaN; `barElapsedEnough` spaces the lines
 *   4c361ab  a render never targets a bar line it cannot reach
 *            -> `firstReachableBar` moves the target out until the line covers the measured cost
 *
 * The fixture is not one recording replayed: it is sixteen generated sessions of 200 bar lines each,
 * with the tempo moving and the model's latency moving under it, and one window in each where the
 * model stops answering for several bars. The generation is seeded, so a failure names its seed and
 * reproduces exactly. The falsifiers at the end run a session of the 2026-10-30 shape through the
 * policy of b019efc and through the ascending sort and slice alone, and record what each one does,
 * so a property that cannot fail is not being read as a pass.
 */
import { describe, it, expect } from 'vitest';
import {
  prunePast, keepNewest, takeForBar, renderStride, renderCeilingBpm, renderBudget,
  firstReachableBar, nextRenderTail, barDelayMs, barMsFor, barElapsedEnough, BAR_FLOOR,
  RENDER_COST_ASSUMED_MS, RENDER_TAIL_ASSUMED_MS, MAX_BPM, MIN_BPM,
} from './bar-queue';
import { AI_BUDGET_MS } from './llm-planner';

type Entry = { bar: number };
type Policy = 'shipped' | 'b019efc' | 'trim-only';

/** 16 sessions of 200 bar lines: 3,200 bars, each with its own tempo changes and latency. */
const SEEDS = 16;
const BARS = 200;

/** mulberry32: 32-bit, seedable, and the same number on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Session {
  /** The tempo in force at each bar, inside the protocol's 20 to 300 BPM. */
  bpm: number[];
  /** The width of each bar, in ms. */
  barMs: number[];
  /** The instant of each bar line in transport ms; `starts[BARS]` is the end of the session. */
  starts: number[];
  /** The latency of a render STARTED at each bar: it drifts, spikes, and hangs in one window. */
  cost: number[];
  /** The bars over which no render completes: the session stops writing model bars. */
  stallFrom: number;
  stallTo: number;
}

function session(seed: number): Session {
  const rnd = rng(seed);
  const bpm: number[] = [];
  const barMs: number[] = [];
  const starts: number[] = [0];
  const cost: number[] = [];

  // A WALK, NOT A SWEEP: the tempo moves the way a listener moves a slider, a step at a time, and it
  // crosses the 171 BPM ceiling a 1300 ms render has, so `renderStride` steps between 1 and 2 inside
  // one session. It moves every 12 to 40 bars, not every bar: a room whose tempo changes constantly
  // is a room whose queue is dropped constantly (`handleBpmChange`), which is a different stress.
  let held = 0;
  let b = 160;
  for (let i = 0; i < BARS; i++) {
    if (held === 0) {
      b = Math.min(MAX_BPM, Math.max(MIN_BPM + 60, b + Math.round((rnd() * 2 - 1) * 45)));
      held = 12 + Math.floor(rnd() * 28);
    }
    held--;
    bpm.push(b);
    const width = barMsFor(b) ?? 2000;
    barMs.push(width);
    starts.push(starts[i]! + width);
  }

  // LATENCY IS A SLOW DRIFT WITH A TAIL. The room's own numbers on 2026-10-30 were 675 to 879 ms of
  // model on a 1500 ms bar with a tail at 1777, so the mean moves between 480 and 1400, 16% of calls
  // spike, and one call in the stall window outlives its bar several times over.
  let mean = 760;
  const stallFrom = 40 + Math.floor(rnd() * (BARS - 90));
  const stallTo = Math.min(BARS - 10, stallFrom + 3 + Math.floor(rnd() * 4));
  for (let i = 0; i < BARS; i++) {
    mean = Math.min(1400, Math.max(480, mean + (rnd() * 240 - 100)));
    let c = mean + rnd() * 300;
    if (rnd() < 0.16) c += 500 + rnd() * 1500;
    if (i >= stallFrom && i < stallTo) c = barMs[i]! * (3 + rnd() * 3);
    cost.push(c);
  }
  return { bpm, barMs, starts, cost, stallFrom, stallTo };
}

interface Attempt {
  bar: number;
  target: number;
  stride: number;
  /** The render cost the stride was taken on: the larger of the assumed cost and the decaying tail. */
  cost: number;
  /** The wall time left before the line of the bar being written. */
  room: number;
  budget: number;
}

/** What one session's loop did, and every invariant it saw broken, named with the seed and bar. */
interface Loop {
  seed: number;
  published: number[];
  attempts: Attempt[];
  /** Renders that landed after their own line: a silent bar, not a lock. */
  missed: number;
  /** Landing events that met the trim with more candidates than there are slots. */
  trims: number;
  /** Bars whose tempo differed from the bar before: the queue is dropped at each one. */
  tempoChanges: number;
  violations: string[];
}

/**
 * The room's bar loop, in the order `onAgentBar` runs it: prune, claim, publish, then the refill gate.
 *
 * One simplification, and it changes no decision: a completion enters the queue at the line after it
 * landed rather than at the instant it landed. The queue's only mid-bar reader is the refresh path,
 * which re-renders the bar already at the head, so the loop sees the same queue either way.
 */
function run(seed: number, policy: Policy = 'shipped'): Loop {
  const s = session(seed);
  const out: Loop = {
    seed, published: [], attempts: [], missed: 0, trims: 0, tempoChanges: 0, violations: [],
  };

  let queue: Entry[] = [];
  const parked: Array<{ bar: number; landsAt: number }> = [];
  let busyUntil = -1;
  let tail = RENDER_TAIL_ASSUMED_MS;

  // THE POLICIES, side by side. b019efc kept the two OLDEST of an ascending sort and never pruned
  // (`findIndex` did the claim): that is the pair that locked the 2026-10-30 recording. The third
  // arm is the ascending sort and slice ALONE, with the prune kept, which is the mutation the card
  // names; it is here so its effect on a whole session is measured, not assumed.
  const trim: <T extends Entry>(q: readonly T[], n: number) => T[] = policy === 'shipped'
    ? keepNewest
    : (q, n) => [...q].sort((a, z) => a.bar - z.bar).slice(0, n);
  const note = (why: string, bar: number): void => { out.violations.push(`seed ${seed} bar ${bar}: ${why}`); };

  for (let bar = 0; bar < BARS; bar++) {
    const at = s.starts[bar]!;
    const width = s.barMs[bar]!;

    // A TEMPO CHANGE DROPS THE QUEUE. `handleBpmChange` empties every agent's queue, because the notes
    // are addressed to the old grid and a bar in flight belongs to the tempo that made it.
    if (bar > 0 && s.bpm[bar] !== s.bpm[bar - 1]) {
      out.tempoChanges++;
      queue = [];
    }

    // A COMPLETION THAT MISSED ITS LINE IS NOT QUEUED on the shipped path: its remaining eighths are
    // patched (`latePatch`) instead, because an entry for a bar that has begun can only be pruned at
    // the next line and would hold a slot the next render needs until then.
    for (let i = parked.length - 1; i >= 0; i--) {
      const p = parked[i]!;
      if (p.landsAt > at) continue;
      parked.splice(i, 1);
      if (policy !== 'b019efc' && p.landsAt >= s.starts[p.bar]!) { out.missed++; continue; }
      queue.push({ bar: p.bar });
      const candidates = queue.length;
      queue = trim(queue, 2);
      if (candidates > 2) {
        out.trims++;
        // THE TRIM'S ONE RULE: the later bar is the one that can still play. If a HIGHER bar was
        // dropped while a lower one survived, the room threw away the bar it had just written.
        const keptMax = queue.reduce((max, q) => Math.max(max, q.bar), 0);
        if (keptMax < p.bar) note('the trim kept an older bar and dropped the one just written', bar);
      }
    }

    // THE PRUNE, at the line and before the claim: a bar that has gone is never a candidate, and the
    // bar that is due now is kept, because a render that finished just before the line still plays.
    if (policy !== 'b019efc') {
      queue = prunePast(queue, bar);
      for (const q of queue) if (q.bar < bar) note('an entry for a bar that has gone survived the prune', bar);
    }
    const claim = takeForBar(queue, bar);
    queue = claim.rest;
    if (claim.ready) {
      // The claim can only hand over the entry written for THIS bar: a stale bar is never shifted
      // into the present, which is the difference between silence and the wrong music.
      if (claim.ready.bar !== bar) note('a stale bar was published', bar);
      out.published.push(bar);
    }

    // The queue is ordered ascending, so `queue[0]` is the next bar — the head the refresh path
    // compares against `barIndexOf(now) + stride`.
    for (let i = 1; i < queue.length; i++) if (queue[i - 1]!.bar >= queue[i]!.bar) note('the queue lost its order', bar);
    if (queue.length > 2) note('the queue outgrew its two slots', bar);

    const cost = Math.max(RENDER_COST_ASSUMED_MS, tail);
    const stride = renderStride(cost, width);
    const depth = stride > 1 ? 1 : 2;
    const queuedMax = queue.reduce((max, q) => Math.max(max, q.bar), 0);

    if (queue.length >= depth || at < busyUntil) continue;

    const need = RENDER_COST_ASSUMED_MS + 100;
    const earliest = Math.max(bar + stride, queuedMax + stride);
    const target = firstReachableBar(s.starts[0]!, width, earliest, at, need);
    const lineAt = s.starts[Math.min(target, BARS)]!;
    if (target < earliest) note('a render was targeted behind the music already queued', bar);
    if (target < BARS && lineAt - at < need && target - earliest < 4) {
      note(`a render was targeted ${Math.round(lineAt - at)} ms from its line, under its ${need} ms cost`, bar);
    }

    // THE BUDGET IS THE BAR, NOT A CONSTANT. On the shipped path it is the time left before the line
    // of the bar being written, less a margin; on the 2026-10-30 path it was 2500 ms, which outlived
    // a 1500 ms bar by a whole bar by construction and guaranteed the miss that started the cascade.
    const room = lineAt - at;
    const budget = policy === 'shipped' ? renderBudget(room, AI_BUDGET_MS) : AI_BUDGET_MS;
    if (budget > Math.max(400, room - 100)) note('a render was given more time than its bar had left', bar);
    if (budget < 400 || budget > AI_BUDGET_MS) note('a render was given a budget outside its floor and ceiling', bar);

    out.attempts.push({ bar, target, stride, cost, room, budget });
    tail = nextRenderTail(tail, s.cost[bar]!);
    parked.push({ bar: target, landsAt: at + s.cost[bar]! });
    busyUntil = at + s.cost[bar]!;
  }
  return out;
}

/** One run per seed per policy, shared by every property: the sessions are the fixture. */
const runs = new Map<string, Loop[]>();
function allRuns(policy: Policy = 'shipped'): Loop[] {
  let made = runs.get(policy);
  if (!made) {
    made = Array.from({ length: SEEDS }, (_, s) => run(s, policy));
    runs.set(policy, made);
  }
  return made;
}

const shipped = (): Loop[] => allRuns('shipped');
const everyViolation = (): string[] => shipped().flatMap(r => r.violations);

describe('the bar loop, over 3,200 generated bars', () => {
  it('measures the fixture: 16 sessions, both strides, a stall window in each', () => {
    const all = shipped();
    const modelBars = all.reduce((n, r) => n + r.published.length, 0);
    const renders = all.reduce((n, r) => n + r.attempts.length, 0);
    const trims = all.reduce((n, r) => n + r.trims, 0);
    const changes = all.reduce((n, r) => n + r.tempoChanges, 0);
    const strides = all.flatMap(r => r.attempts.map(a => a.stride));
    const stalls = all.map(r => session(r.seed).stallTo - session(r.seed).stallFrom);
    console.log(
      `bar lines simulated: ${SEEDS * BARS} over ${SEEDS} sessions; ` +
      `model bars ${modelBars}; renders ${renders}; ` +
      `stride 2 at ${strides.filter(s => s > 1).length} renders; tempo changes ${changes}; ` +
      `stall windows ${Math.min(...stalls)} to ${Math.max(...stalls)} bars; ` +
      `landings that met more candidates than slots ${trims}`,
    );
    expect(SEEDS * BARS).toBeGreaterThanOrEqual(1000);
    expect(modelBars).toBeGreaterThan(0);
    expect(renders).toBeGreaterThan(0);
    expect(strides.some(s => s === 1)).toBe(true);
    expect(strides.some(s => s > 1)).toBe(true);
    expect(changes).toBeGreaterThanOrEqual(SEEDS * 3);
    // MEASURED, AND IT MATTERS: a render is serialised by `agent.busy` and the queue is trimmed at
    // every push, so a completion never meets more than two candidates and the trim never has to
    // choose. Its rule is proved by the generated queues below, not by the loop; that is also why the
    // ascending sort and slice on its own leaves this loop unchanged (see the falsifier at the end).
    expect(trims).toBe(0);
  });

  it('publishes only the entry written for the bar that is playing', () => {
    expect(everyViolation().filter(v => v.includes('stale'))).toEqual([]);
    expect(shipped().every(r => r.published.length > 0)).toBe(true);
  });

  it('never keeps an entry for a bar that has gone, and never outgrows its two slots', () => {
    expect(everyViolation().filter(v => v.includes('prune') || v.includes('slots') || v.includes('order')))
      .toEqual([]);
  });

  it('keeps writing model bars to the end of the session, through the stall', () => {
    // THE INVARIANT b019efc BOUGHT: a session that stops answering for several bars does not go quiet
    // for the rest of the night. Every session asks again after its stall and is still asking in its
    // last bars; the 2026-10-30 room asked for nothing after bar 10 of 53.
    for (const r of shipped()) {
      const s = session(r.seed);
      const barsAsked = r.attempts.map(a => a.bar);
      const last = Math.max(...barsAsked);
      expect(last, `seed ${r.seed} stopped asking at bar ${last} of ${BARS}`).toBeGreaterThanOrEqual(BARS - 6);
      expect(barsAsked.filter(b => b > s.stallTo).length, `seed ${r.seed} never asked again after its stall`)
        .toBeGreaterThan(0);
      expect(r.published.filter(b => b >= BARS - 12).length, `seed ${r.seed} wrote no model bar in its last 12 bars`)
        .toBeGreaterThan(0);
    }
  });

  it('never targets a line its render cannot reach, and never behind the queued music', () => {
    expect(everyViolation().filter(v => v.includes('targeted'))).toEqual([]);
  });

  it('never gives a render more time than the bar it is writing has left', () => {
    expect(everyViolation().filter(v => v.includes('budget'))).toEqual([]);
  });

  it('keeps the phrase rate: the stride is the smallest step that covers the render', () => {
    // Above the ceiling the agent writes every stride-th bar, and the stride is minimal: one step
    // shorter would not cover the render, and one step longer would waste a bar of the phrase rate.
    for (const r of shipped()) {
      for (const a of r.attempts) {
        const width = session(r.seed).barMs[a.bar]!;
        expect(a.stride).toBeGreaterThanOrEqual(1);
        expect(a.stride * width, `seed ${r.seed} bar ${a.bar}`).toBeGreaterThanOrEqual(a.cost);
        expect((a.stride - 1) * width).toBeLessThan(a.cost + 100);
      }
    }
  });

  it('names a ceiling the stride can hold, at every tempo the sessions visited', () => {
    for (const r of shipped()) {
      const s = session(r.seed);
      for (const a of r.attempts) {
        const at = s.bpm[a.bar]!;
        const ceiling = renderCeilingBpm(a.cost);
        expect(ceiling, `seed ${r.seed} bar ${a.bar}`).not.toBeNull();
        const last = ceiling as number;
        if (last < 1 || last >= MAX_BPM) continue;
        const widthAt = barMsFor(last);
        const widthAbove = barMsFor(last + 1);
        if (widthAt === null || widthAbove === null) continue;
        expect(renderStride(a.cost, widthAt), `stride at the ceiling ${last} BPM`).toBe(1);
        expect(renderStride(a.cost, widthAbove), `stride one BPM above ${last}`).toBe(2);
        // And the ceiling names a tempo this session could have been at, so the number on the surface
        // is never above the fastest tempo the protocol allows.
        expect(last).toBeLessThanOrEqual(MAX_BPM);
        expect(at).toBeGreaterThanOrEqual(MIN_BPM);
      }
    }
  });
});

describe('the bar line, over generated timer fires', () => {
  const fires = 3_000;

  it('never hands setTimeout a 0, a NaN, or a wait longer than a bar', () => {
    let now = 0;
    let bpm = 160;
    for (let i = 0; i < fires; i++) {
      const width = barMsFor(bpm) as number;
      const wait = barDelayMs(0, bpm, now);
      expect(wait, `fire ${i}`).not.toBeNull();
      expect(Number.isFinite(wait as number)).toBe(true);
      expect(wait as number).toBeGreaterThanOrEqual(1);       // 0 is a free-running loop
      expect(wait as number).toBeLessThanOrEqual(width + 1e-9);
      now += (wait as number) + (i % 7 === 0 ? -2 : 1);       // a timer a few ms early, or late
      if (i % 11 === 0) bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm + ((i % 3) - 1) * 25));
    }
  });

  it('measures the wait on the grid in force when it is armed, every bar', () => {
    // A tempo change under a timer is the case the old inline arithmetic got wrong: the wait was
    // computed on a grid that no longer existed, and `setTimeout` fired a NaN or a 0.
    for (let i = 0; i < fires; i++) {
      const bpm = MIN_BPM + (i % 41);
      const width = barMsFor(bpm) as number;
      const now = (i * 137) % 9_000;
      const wait = barDelayMs(0, bpm, now) as number;
      const lands = now + wait;
      const offset = ((lands % width) + width) % width;
      // IT LANDS ON A LINE OF THIS GRID, to within the module's own 1 ms floor: a wait is never
      // shorter than 1 ms, so a clock sitting under a millisecond from the line fires 1 ms late.
      expect(Math.min(offset, width - offset), `fire ${i} at ${bpm} BPM`).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('announces one bar per bar, and refuses a fire that arrives inside the bar', () => {
    // The 2026-10-30 storm: 269 announcements in 2.6 s. The guard is the clock, and the index is the
    // invariant, because at a fractional bar length a wait can land on the previous index.
    let accepted = 0;
    let refusedEarly = 0;
    let lastAt = 0;
    let lastBar = -1;
    for (let i = 0; i < fires; i++) {
      const bpm = 115 + (i % 7) * 12;
      const width = barMsFor(bpm) as number;
      const line = i * width;
      const fireAt = i % 5 === 0 ? line - 3 : line;            // a timer that fires a few ms early
      const bar = Math.floor(fireAt / width);
      if (bar <= lastBar || !barElapsedEnough(lastAt, fireAt, width)) {
        if (fireAt < line) refusedEarly++;
        continue;
      }
      if (accepted > 0) {
        expect(fireAt - lastAt, `fire ${i}`).toBeGreaterThanOrEqual(width * BAR_FLOOR - 1e-9);
      }
      accepted++;
      lastAt = fireAt;
      lastBar = bar;
    }
    expect(refusedEarly).toBeGreaterThan(0);                  // the guard had work to do
    expect(accepted).toBeLessThanOrEqual(fires);              // never more announcements than bars
  });
});

describe('the trim, over generated queues', () => {
  const queueCases = 240;

  it('keeps the newest entries when more arrive than there are slots', () => {
    // The card's mutation lives here: an ascending sort and slice keeps the LOWEST bars, which on a
    // late render were bars that had already gone. Two of those held both slots on 2026-10-30 and no
    // render was attempted again for the rest of the night.
    for (let c = 0; c < queueCases; c++) {
      const rnd = rng(919 + c);
      const size = 1 + Math.floor(rnd() * 6);
      const bars = new Set<number>();
      while (bars.size < size) bars.add(Math.floor(rnd() * 400));
      const queue = [...bars].map(bar => ({ bar }));
      const keep = 1 + Math.floor(rnd() * 3);
      const kept = keepNewest(queue, keep);
      const newest = [...queue].sort((a, b) => b.bar - a.bar).slice(0, keep);
      expect(kept.length, `case ${c}`).toBe(Math.min(keep, queue.length));
      expect(kept.map(q => q.bar)).toEqual([...newest].reverse().map(q => q.bar)); // ascending, newest
    }
  });

  it('fails the same cases under the ascending sort and slice', () => {
    // The falsifier for the property above: the old trim keeps the LOWEST bars. If this ever passes,
    // the property above stopped distinguishing anything and must be rewritten.
    let wrong = 0;
    for (let c = 0; c < queueCases; c++) {
      const rnd = rng(919 + c);
      const size = 1 + Math.floor(rnd() * 6);
      const bars = new Set<number>();
      while (bars.size < size) bars.add(Math.floor(rnd() * 400));
      const queue = [...bars].map(bar => ({ bar }));
      const keep = 1 + Math.floor(rnd() * 3);
      const legacy = [...queue].sort((a, b) => a.bar - b.bar).slice(0, keep);
      const right = keepNewest(queue, keep);
      if (legacy.map(q => q.bar).join() !== right.map(q => q.bar).join()) wrong++;
    }
    expect(wrong, 'the ascending sort and slice agreed with the shipped trim everywhere')
      .toBeGreaterThan(queueCases / 4);
  });
});

/**
 * THE 2026-10-30 SESSION, AS A SESSION: 160 BPM, one bar every 1500 ms, 675 to 879 ms of model, and
 * one render in seven overrunning by a whole bar. This is the fixture the recording describes, and it
 * is the one the card calls "a simulated session that stops writing model bars".
 */
describe('a 160 BPM session with one render in seven overrunning', () => {
  const RECORDING_BARS = 200;
  const BAR = 1500;

  function recordingSession(seed: number, policy: Policy) {
    const rnd = rng(seed);
    const starts = Array.from({ length: RECORDING_BARS + 1 }, (_, i) => i * BAR);
    const trim: <T extends Entry>(q: readonly T[], n: number) => T[] = policy === 'shipped'
      ? keepNewest
      : (q, n) => [...q].sort((a, z) => a.bar - z.bar).slice(0, n);
    let queue: Entry[] = [];
    const parked: Array<{ bar: number; landsAt: number }> = [];
    let busyUntil = -1;
    const published: number[] = [];
    const attempts: number[] = [];

    for (let bar = 0; bar < RECORDING_BARS; bar++) {
      const at = starts[bar]!;
      for (let i = parked.length - 1; i >= 0; i--) {
        const p = parked[i]!;
        if (p.landsAt > at) continue;
        parked.splice(i, 1);
        // The pre-fix room queued an answer even for a bar that had begun; the shipped one patches it.
        if (policy !== 'b019efc' && p.landsAt >= starts[p.bar]!) continue;
        queue.push({ bar: p.bar });
        queue = trim(queue, 2);
      }
      if (policy !== 'b019efc') queue = prunePast(queue, bar);
      const claim = takeForBar(queue, bar);
      queue = claim.rest;
      if (claim.ready) published.push(bar);
      if (queue.length >= 2 || at < busyUntil) continue;
      attempts.push(bar);
      const cost = 675 + rnd() * 204 + (bar % 7 === 3 ? BAR : 0);
      parked.push({ bar: bar + 1, landsAt: at + cost });
      busyUntil = at + cost;
    }
    return { published, attempts };
  }

  const sessions = [0, 1, 2, 3, 4, 5, 6, 7];
  const recorded = (policy: Policy) => sessions.map(s => recordingSession(s, policy));

  it('keeps writing model bars under the shipped policy', () => {
    for (const r of recorded('shipped')) {
      expect(Math.max(...r.attempts), 'the line went quiet').toBeGreaterThanOrEqual(RECORDING_BARS - 4);
      expect(r.published.length).toBeGreaterThan(RECORDING_BARS / 2);
      expect(r.published.filter(b => b >= RECORDING_BARS - 10).length).toBeGreaterThan(0);
    }
  });

  it('locks under the policy of b019efc: the line speaks, then nothing', () => {
    const before = recorded('b019efc');
    console.log(
      `b019efc on the 160 BPM session: ` +
      `model bars ${before.reduce((n, r) => n + r.published.length, 0)}, ` +
      `last render ${Math.max(...before.map(r => Math.max(...r.attempts)))} of ${RECORDING_BARS}`,
    );
    const shippedBars = recorded('shipped').reduce((n, r) => n + r.published.length, 0);
    expect(before.reduce((n, r) => n + r.published.length, 0)).toBeLessThan(shippedBars / 4);
    for (const r of before) {
      expect(Math.max(...r.attempts), 'the old queue did not lock').toBeLessThan(RECORDING_BARS / 2);
      expect(r.published.length).toBeGreaterThan(0);            // it spoke first, then stopped
    }
  });

  it('is unchanged by the ascending sort and slice alone, which is why its rule is proved on queues', () => {
    // MEASURED, NOT ASSUMED. The card's mutation is the sort and slice WITHOUT the missing prune, and
    // on its own it cannot stop this session: `prunePast` (the other half of b019efc) drops the dead
    // entry at the next line before it can ever hold a slot, and a completion never meets more than
    // two candidates. The session above is identical under both, bar for bar. The mutation is caught
    // by the trim's own property and by nothing else here, which is the finding this test records.
    const mutated = recorded('trim-only');
    const right = recorded('shipped');
    for (let i = 0; i < sessions.length; i++) {
      expect(mutated[i]!.published, `session ${sessions[i]}`).toEqual(right[i]!.published);
      expect(mutated[i]!.attempts).toEqual(right[i]!.attempts);
    }
  });
});
