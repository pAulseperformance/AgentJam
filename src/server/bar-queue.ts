/**
 * The agent's two-slot bar queue, as pure operations.
 *
 * MEASURED ON THE LIVE RECORDING OF 2026-10-30 (106 bars, 160 BPM, default-room): the model line spoke
 * in 3 bars, all inside the first 8.3 seconds, and never again in the 47 bars that followed. The cause
 * was this queue, not the model and not the decision layer. A render that overran its bar line left an
 * entry whose bar had already passed; `findIndex(q => q.bar === bar)` could never match it again, and
 * the trim kept the OLDEST two of an ascending sort, so every later render was thrown away to protect
 * two entries that could never play. Once two dead entries were present, `queue.length < 2` was false
 * and no render was attempted at all. The agent played the pattern generator for the rest of the night.
 *
 * The rules that keep that from happening again:
 *   - a bar that has passed is never a candidate, so it is pruned at the bar line;
 *   - the trim keeps the NEWEST entries, because only a later bar can still play;
 *   - the model's budget is measured against the time left in the bar, not a fixed 2.5 seconds.
 */
export interface QueuedBar {
  bar: number;
}

/**
 * Remove entries whose bar has already been published or skipped. The bar that is due NOW is kept,
 * because the claim happens after this: a render that finished just before the line still plays.
 */
export function prunePast<T extends QueuedBar>(queue: readonly T[], currentBar: number): T[] {
  return queue.filter(q => q.bar >= currentBar);
}

/** Keep the n newest entries, returned in ascending order so `queue[0]` is the next bar. */
export function keepNewest<T extends QueuedBar>(queue: readonly T[], n: number): T[] {
  return [...queue]
    .sort((a, b) => b.bar - a.bar)
    .slice(0, n)
    .sort((a, b) => a.bar - b.bar);
}

/**
 * Publish the entry written for this bar. Anything else stays where it is: a bar that arrives late is
 * a bar the model missed, and the pattern generator covers it rather than shifting stale music into
 * the present. The difference from the old code is that "stays where it is" now means "for one loop
 * iteration, until the prune", not "forever".
 */
export function takeForBar<T extends QueuedBar>(
  queue: readonly T[],
  bar: number,
): { ready: T | null; rest: T[] } {
  const at = queue.findIndex(q => q.bar === bar);
  if (at === -1) return { ready: null, rest: [...queue] };
  const rest = [...queue];
  const [ready] = rest.splice(at, 1);
  return { ready: ready ?? null, rest };
}

/**
 * How long the model may take, given the time actually left before the bar line it is writing for.
 * A budget longer than the bar guarantees a miss: the old 2500ms against a 1500ms bar at 160 BPM was
 * over by a whole bar, and one such call is what started the cascade.
 */
export function renderBudget(untilBarMs: number, maxMs: number, marginMs = 100): number {
  return Math.max(400, Math.min(maxMs, untilBarMs - marginMs));
}

/**
 * What one bar costs before it can be published, measured on the live route (2026-10-30): 407-420 ms
 * of Jev plus 675-879 ms of model. A new agent starts at the worst observed call, not the median,
 * because guessing low is the expensive direction: a first bar that overruns costs the agent its slot.
 */
export const RENDER_COST_ASSUMED_MS = 1300;

/**
 * How many bars an agent writes one bar of music: 1 when a render fits inside a bar, n when it does
 * not. At 160 BPM a bar is 1500 ms and a render costs about 1.3 s, so stride 1; at 200 BPM the bar is
 * 1200 ms and the same render needs 2 bars. This is the "reduce the tempo of the player" rule: the
 * room's grid is untouched and the agent's phrase rate in real time stays about level, instead of
 * writing bars that miss their line and are thrown away.
 */
export function renderStride(renderCostMs: number, barMs: number, marginMs = 100): number {
  if (!(barMs > 0) || !(renderCostMs > 0)) return 1;
  return Math.max(1, Math.ceil((renderCostMs + marginMs) / barMs));
}

/**
 * THE TEMPO CEILING: the fastest tempo at which a render of `renderCostMs` still fits inside ONE
 * bar, so the agent still writes one bar of music per bar. It is `renderStride` inverted: stride
 * stays 1 while `barMs >= cost + margin`, and `barMs = 240000 / bpm`, so the last tempo that holds
 * is `240000 / (cost + margin)` BPM. Floored, not rounded: the control moves in whole BPM, and a
 * ceiling rounded UP would name a tempo the stride cannot hold.
 *
 * This is the number the surface marks under the tempo control (Task 13). It is derived here, beside
 * the function it inverts, because two copies of the inversion would drift the day one margin moves.
 */
export function renderCeilingBpm(renderCostMs: number, marginMs = 100): number | null {
  const totalMs = renderCostMs + marginMs;
  if (!(totalMs > 0) || !Number.isFinite(totalMs)) return null;
  const bpm = 240_000 / totalMs;
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  return Math.floor(bpm);
}

/**
 * HOW MANY SHORT CELLS FIT IN A GAP BAR.
 *
 * A cell is a statement, not a bar: at 200 BPM a bar is 1200 ms and three cells of about 380 ms each
 * sit on its eighth grid, where the agent's own line can be quoted without the gap becoming a second
 * melody. The count follows the bar's WIDTH and is capped, because a six-second ambient bar is a place
 * for two held notes, not for four gestures. Never 0: a gap bar with no cell is a hole in the room.
 */
export function cellsForBar(barMs: number, minCellMs = 380, maxCells = 4): number {
  if (!(barMs > 0) || !(minCellMs > 0)) return 1;
  return Math.max(1, Math.min(Math.max(1, maxCells), Math.floor(barMs / minCellMs)));
}

/** The protocol's tempo range, enforced again in the room: the schema runs in the client. */
export const MIN_BPM = 20;
export const MAX_BPM = 300;
/** Below this a bar is not a musical unit any player can address: 400 ms is 1.5 beats at 300 BPM. */
export const MIN_BAR_MS = 400;
/** 120 BPM, the room's default, used when a stored tempo cannot be read at all. */
export const DEFAULT_BAR_MS = 2000;

/** The width of a bar, or null when the tempo cannot describe one. */
export function barMsFor(bpm: number): number | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  const barMs = (60 / bpm) * 4 * 1000;
  return Number.isFinite(barMs) && barMs >= MIN_BAR_MS ? barMs : null;
}

/**
 * The wait until the next bar line, or null when the transport cannot be computed.
 *
 * The inline version this replaces was `Math.max(0, nextBarStart() - now)`. On a bar length of NaN, or
 * Infinity, or a line in the past, that hands `setTimeout` a NaN or a 0, and Workers fires those at
 * once. The callback re-arms itself, so one bad wait is a free-running loop: every turn publishes a
 * pattern bar and a debug record. Never 0, never NaN, never a silent clamp.
 */
export function barDelayMs(transportStartTime: number, bpm: number, now: number): number | null {
  const barMs = barMsFor(bpm);
  if (barMs === null) return null;
  if (!Number.isFinite(transportStartTime)) return null;
  const elapsed = now - transportStartTime;
  if (!Number.isFinite(elapsed)) return null;
  const next = transportStartTime + (Math.floor(elapsed / barMs) + 1) * barMs;
  const wait = next - now;
  return Number.isFinite(wait) ? Math.max(1, wait) : null;
}

/**
 * The least time between two announcements: eight tenths of a bar. A healthy room announces once per
 * bar, and the slack covers a timer that fires a few milliseconds early on a line.
 */
export const BAR_FLOOR = 0.8;

/**
 * Whether enough time has passed since the last bar this agent announced for the announcement to be a
 * bar line rather than a loop. Half a bar is the threshold: a healthy room never announces two bars
 * closer together than a bar, and the recordings of 2026-10-30 show what announcing 269 of them in
 * 2.6 s does to a listener's file and to the model's chance of ever being heard.
 */
export function barElapsedEnough(lastPublishedAt: number, now: number, barMs: number): boolean {
  if (lastPublishedAt <= 0) return true;
  if (!(barMs > 0)) return true;
  return now - lastPublishedAt >= barMs * BAR_FLOOR;
}

/**
 * The first bar line this render can actually reach.
 *
 * A render started mid-bar inherits only the remainder of that bar: measured 2026-10-30 17:02, an agent
 * spawned 2.2 s into an 80 BPM bar had 774 ms to produce its first bar and failed with "AI call
 * exceeded 674ms", while every later bar of the same agent took 411-909 ms. So the target moves out one
 * bar at a time until the time to its own line covers the agent's measured cost. Bounded, because a
 * caller with a wrong clock must not walk the bar number into the distance.
 */
export function firstReachableBar(
  transportStartTime: number,
  barMs: number,
  fromBar: number,
  now: number,
  needMs: number,
  maxSteps = 4,
): number {
  if (!(barMs > 0) || !Number.isFinite(transportStartTime) || !Number.isFinite(now)) return fromBar;
  let bar = fromBar;
  for (let i = 0; i < maxSteps; i++) {
    const lineAt = transportStartTime + bar * barMs;
    if (lineAt - now >= needMs) break;
    bar += 1;
  }
  return bar;
}

/**
 * The tail of what a render costs, as a decaying maximum.
 *
 * An EWMA answers "what does a render usually cost", and the stride needs "how long can one take before
 * it misses". Measured at 160 BPM: the p90 model call is 1166 ms against a 1500 ms bar, so an EWMA of
 * about 1300 keeps stride 1 and misses roughly a quarter of its bars, while the tail (1800) steps to 2
 * and every written bar lands. The decay is what lets a cold start pass: 10% a render, so an outlier is
 * forgotten in about ten bars instead of pinning the room's phrase rate for the session.
 */
export function nextRenderTail(previous: number, cost: number, decay = 0.9): number {
  if (!(cost > 0)) return previous > 0 ? previous * decay : 0;
  return Math.max(cost, previous > 0 ? previous * decay : 0);
}

/**
 * What a render's TAIL is assumed to be before any has been measured: the worst call seen on the live
 * route (1777 ms of model at 200 BPM, 1822 ms at 160). Seeding the tail at the typical 1300 ms is what
 * cost two agents their first bar at 160 BPM: the mean said a 1500 ms bar had room, and the first real
 * call took 1,312 ms of budget and overran it.
 */
export const RENDER_TAIL_ASSUMED_MS = 1800;

/**
 * The wall-clock address of one note's slot, carried in the message so the CLIENT can put it on the grid.
 *
 * MEASURED (session 2026-10-31T15-44-31, 125 BPM, 83 s, 721 notes): the server's own emissions hold the
 * phrase's internal rhythm to the millisecond (gaps of 240 ms for a half beat at 125 BPM), while the
 * client plays every note on ARRIVAL plus a fixed 40 ms, so socket and main-thread jitter land straight in
 * the audio. Against the drummer's kick, 73% of notes sat within 40 ms of their slot and the rest were
 * off by 100 to 300 ms. `at` is the slot on the room's clock; `in` is the same slot as a delay from the
 * moment the message leaves, which needs no clock agreement between browser and server.
 */
export function slotStamp(barStart: number, beatTime: number, beatMs: number, now: number): { at: number; in: number } {
  const at = Math.round(barStart + beatTime * beatMs);
  return { at, in: at - now };
}
