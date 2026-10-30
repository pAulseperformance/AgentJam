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
