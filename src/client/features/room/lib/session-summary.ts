/**
 * SESSION SUMMARY.
 *
 * The panel at the foot of the room draws five states and a dozen numbers, and none of them need a
 * browser: this module takes the recorder's own snapshot and returns exactly what the card paints.
 * That split is deliberate. `vitest.config.ts` runs this repo under `defineWorkersConfig` with no DOM
 * environment, so a `.tsx` test has nowhere to run; the numbers are the part worth gating, so they
 * live here and the pixels stay dumb.
 *
 * THE UNIT, said once. `bars` holds one record per (agent, bar). Three agents across thirty room bars
 * is ninety records, not thirty. Every count here is a RECORD count, the model row says so in words,
 * and the head tag carries the room-bar figure beside it so the two units can never be read as one.
 * Room bars come from the clock (`240000 / bpm` ms per bar, the same figure `tools/probe-session.mjs`
 * uses), never from the record count, because a `late` patch is a second record for a bar that
 * already had one.
 *
 * NOT EVERY RECORD IS A BAR. The planner publishes six sources:
 *   llm      the model wrote the bar
 *   rest     the agent chose to sit the bar out
 *   pattern  the generator filled the bar
 *   fallback the model failed and a code measure played instead (carries `error`)
 *   cell     the agent's own short figures, written by the room when a render could not fit the bar
 *   late     the model's line played into the eighths still ahead; its own music, but not a bar
 * `late` is therefore kept OUT of the denominator (see `latePatches`), and `cell` gets its own row so
 * the rows always add up to the denominator. The artifact this panel copies printed `50 of 87` beside
 * `12 + 35` and added to 97; a set of rows that cannot reconcile is the defect, not the detail.
 */

/** The five states the artifact draws, and no sixth. */
export type SessionState = 'empty' | 'one' | 'many' | 'error' | 'signed out';

/** One row of the card: a key, a value and whether it is a failure (drawn `--alert`). */
export interface SummaryRow {
  key: string;
  value: string;
  alert?: boolean;
}

/** One mark on the bar strip. Colour is the panel's business; the words are this module's. */
export interface SummaryChip {
  /** 1-based position among the bar records, so a tooltip can name the bar */
  bar: number;
  source: string;
  /** plain words for the source: `model`, `rest`, `generator`, `fallback`, `short figures`, `other` */
  sourceLabel: string;
  failed: boolean;
  /** every chip says what it is in words, because colour alone carries no information */
  title: string;
}

export interface SummaryNumbers {
  /** bar records: every `ai_debug` except `late`, which is a patch on a bar rather than a bar */
  records: number;
  /** the room bars the clock says the session ran, from `recordedMs` and `bpm` */
  roomBars: number | null;
  model: number;
  rests: number;
  quiet: number;
  cells: number;
  fallbacks: number;
  /** records whose `source` is missing or not one of the six */
  other: number;
  failed: number;
  latePatches: number;
  /** middle and slowest render of the model bars, in whole ms */
  p50Ms: number | null;
  worstMs: number | null;
}

export interface SessionSummary {
  state: SessionState;
  /** the state in plain words, printed on the card */
  stateLabel: string;
  /** the head tag: how long the session ran and at what tempo */
  tag: string;
  rows: SummaryRow[];
  chips: SummaryChip[];
  /** one sentence saying what this state means, in words a player who never read the code can use */
  sentence: string;
  /** what the strip's marks and colours mean; null when no strip is drawn */
  legend: string | null;
  /** the arithmetic that joins records to room bars; null when there is nothing to join */
  unit: string | null;
  agents: string[];
  numbers: SummaryNumbers;
}

export interface SessionSummaryInput {
  /** `sessionSnapshot().bars` — the projection in session-recorder.ts, read defensively because it is
   *  typed as `Record<string, unknown>` and a field the projection forgot arrives as `undefined` */
  bars: ReadonlyArray<Record<string, unknown>>;
  /** `sessionSnapshot().recordedMs` */
  recordedMs: number;
  /** `sessionSnapshot().bpm` */
  bpm: number | null;
  /** the page's `whoami` answer. `false` is the public tier, which outranks every other state. */
  signedIn: boolean;
}

/** How many records the strip draws before it stops and says so. */
export const MAX_CHIPS = 160;

const SOURCE_LABELS: Record<string, string> = {
  llm: 'model',
  rest: 'rest',
  pattern: 'generator',
  fallback: 'fallback',
  cell: 'short figures',
};

/** Order the chips' sources are named in the legend. */
const SOURCE_ORDER = ['llm', 'rest', 'pattern', 'fallback', 'cell'];

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function sourceOf(row: Record<string, unknown>): string | null {
  return readString(row.source);
}

function sourceLabelOf(source: string | null): string {
  if (source === null) return 'other';
  return SOURCE_LABELS[source] ?? 'other';
}

/** One room bar, in ms: four beats at the session's tempo. The same figure the probe divides by. */
export function barMsFor(bpm: number | null): number | null {
  if (bpm === null || bpm <= 0) return null;
  return 240_000 / bpm;
}

/** How many room bars the clock says the session ran. Not derived from records (see the header). */
export function roomBarsFor(recordedMs: number, bpm: number | null): number | null {
  const barMs = barMsFor(bpm);
  if (barMs === null || recordedMs <= 0) return null;
  return Math.round(recordedMs / barMs);
}

/** The names of the agents that wrote at least one bar, in the order they first appear. */
export function agentsOf(bars: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of bars) {
    if (sourceOf(row) === 'late') continue;
    const name = readString(row.agent);
    if (name) seen.add(name);
  }
  return Array.from(seen);
}

/**
 * WHICH OF THE FIVE DRAWS.
 *
 * The five mix three independent axes (who, how much recorded, any failure), so this is an ordered
 * rule and not a switch. Tier first, because the public tier is a different answer to "what is this
 * card", then nothing-played, then failure, then the size of the band:
 *
 *   1. `signed out`  when `signedIn === false`
 *   2. `empty`       when there is no bar record at all
 *   3. `error`       when any bar record carries an `error`
 *   4. `many`        when two or more agents are named
 *   5. `one`         otherwise
 *
 * `error` outranks `one` and `many` on purpose: a failed render must not hide behind a clean card.
 * `signed out` outranks everything, which is the one place this rule loses information; the sentence
 * for that state says what still plays instead of drawing numbers a guest cannot act on.
 */
export function stateOf(input: SessionSummaryInput): SessionState {
  if (input.signedIn === false) return 'signed out';
  const barRecords = input.bars.filter((row) => sourceOf(row) !== 'late');
  if (barRecords.length === 0) return 'empty';
  if (barRecords.some((row) => readString(row.error) !== null)) return 'error';
  return agentsOf(input.bars).length >= 2 ? 'many' : 'one';
}

/** The middle of a list of numbers, by the usual convention: mean of the two middles when even. */
export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return Math.round(upper);
  const lower = sorted[middle - 1];
  if (lower === undefined) return Math.round(upper);
  return Math.round((lower + upper) / 2);
}

function numbersOf(bars: ReadonlyArray<Record<string, unknown>>, recordedMs: number, bpm: number | null): SummaryNumbers {
  let model = 0;
  let rests = 0;
  let quiet = 0;
  let cells = 0;
  let fallbacks = 0;
  let other = 0;
  let failed = 0;
  let latePatches = 0;
  const modelLatencies: number[] = [];

  for (const row of bars) {
    const source = sourceOf(row);
    if (source === 'late') {
      latePatches += 1;
      continue;
    }
    if (readString(row.error) !== null) failed += 1;
    switch (source) {
      case 'llm': {
        model += 1;
        const latency = readNumber(row.latencyMs);
        if (latency !== null) modelLatencies.push(latency);
        break;
      }
      case 'rest': rests += 1; break;
      case 'pattern': quiet += 1; break;
      case 'cell': cells += 1; break;
      case 'fallback': fallbacks += 1; break;
      default: other += 1; break;
    }
  }

  const worst = modelLatencies.length > 0 ? Math.round(Math.max(...modelLatencies)) : null;

  return {
    records: model + rests + quiet + cells + fallbacks + other,
    roomBars: roomBarsFor(recordedMs, bpm),
    model,
    rests,
    quiet,
    cells,
    fallbacks,
    other,
    failed,
    latePatches,
    p50Ms: median(modelLatencies),
    worstMs: worst,
  };
}

function rowsOf(numbers: SummaryNumbers, reason: string | null): SummaryRow[] {
  const rows: SummaryRow[] = [
    // the unit is on the row itself, not only in the footnote: this is the denominator that read as
    // room bars in the artifact and printed a total no session could produce
    { key: 'Model bars', value: `${numbers.model} of ${numbers.records} agent-bar records` },
    { key: 'Rests', value: String(numbers.rests) },
    { key: 'Quiet bars (generator)', value: String(numbers.quiet) },
  ];
  // a row only when the class is present, so the panel never prints a row of zeros for a source the
  // session did not use
  if (numbers.cells > 0) rows.push({ key: 'Short figures (agent\'s own)', value: String(numbers.cells) });
  if (numbers.fallbacks > 0) rows.push({ key: 'Fallback bars', value: String(numbers.fallbacks) });
  if (numbers.other > 0) rows.push({ key: 'Other bars', value: String(numbers.other) });

  rows.push({
    key: 'Render time, middle / slowest',
    value: numbers.p50Ms === null || numbers.worstMs === null
      ? 'no model bar to time'
      : `${numbers.p50Ms} / ${numbers.worstMs} ms`,
  });

  if (numbers.failed > 0) {
    rows.push({ key: 'Failed renders', value: String(numbers.failed), alert: true });
    rows.push({ key: 'Reason', value: reason ?? 'no reason recorded', alert: true });
  }
  return rows;
}

function chipsOf(bars: ReadonlyArray<Record<string, unknown>>): SummaryChip[] {
  const barRecords = bars.filter((row) => sourceOf(row) !== 'late');
  const drawn = barRecords.length > MAX_CHIPS ? barRecords.slice(barRecords.length - MAX_CHIPS) : barRecords;
  const offset = barRecords.length - drawn.length;

  return drawn.map((row, index) => {
    const source = sourceOf(row);
    const sourceLabel = sourceLabelOf(source);
    const failed = readString(row.error) !== null;
    const agent = readString(row.agent) ?? 'an unnamed agent';
    const error = readString(row.error);
    return {
      bar: offset + index + 1,
      source: source ?? 'other',
      sourceLabel,
      failed,
      title: `bar ${offset + index + 1}: ${sourceLabel}, ${agent}${failed && error ? ` — render failed: ${error}` : ''}`,
    };
  });
}

function legendOf(chips: ReadonlyArray<SummaryChip>): string {
  const present = SOURCE_ORDER.filter((source) => chips.some((chip) => chip.source === source));
  const words = present.map((source) => SOURCE_LABELS[source]).filter((word): word is string => word !== undefined);
  const failed = chips.some((chip) => chip.failed);
  const parts = [
    `Each chip is one bar record, oldest first: ${words.join(', ')}.`,
  ];
  if (failed) parts.push('A chip with an outline is a render that fell back.');
  return parts.join(' ');
}

function labelForAgents(agents: ReadonlyArray<string>): string {
  if (agents.length === 0) return 'the band';
  if (agents.length === 1) return agents[0] ?? 'the band';
  if (agents.length === 2) return `${agents[0]} and ${agents[1]}`;
  return `${agents.slice(0, -1).join(', ')} and ${agents[agents.length - 1]}`;
}

function tagOf(state: SessionState, recordedMs: number, bpm: number | null): string {
  if (state === 'empty') return 'no session yet';
  if (state === 'signed out') return 'public tier';
  const seconds = Math.round(recordedMs / 1000);
  const tempo = bpm === null ? null : `${bpm} BPM`;
  const roomBars = roomBarsFor(recordedMs, bpm);
  const parts = [tempo === null ? `${seconds} s` : `${seconds} s at ${tempo}`];
  if (roomBars !== null) parts.push(`${roomBars} room bars`);
  return parts.join(' · ');
}

function sentenceOf(state: SessionState, numbers: SummaryNumbers, agents: ReadonlyArray<string>): string {
  switch (state) {
    case 'empty':
      return 'Nothing has played in this room since the page opened. Join, spawn an agent, and this panel fills at the bar line.';
    case 'signed out': {
      const base = 'Signed out, the room still plays without the decision layer: the drummer and the bass carry every bar, and no agent lands a note or sits one out.';
      // OPEN-1 of the screen spec, taken at its recommendation: a guest who heard a fallback gets one
      // line saying so, inside this state rather than as a sixth state. Delete this line to undo.
      return numbers.failed > 0
        ? `${base} A render fell back during this session, and those bars were carried by the code.`
        : base;
    }
    case 'error':
      return 'A render fell back, so a code measure played in its place. The reason is below, word for word, because the export carries it and nobody reads a log.';
    case 'many':
      return `${labelForAgents(agents)} played this session.`;
    case 'one':
    default:
      return `${labelForAgents(agents)} wrote this session. A rest is a bar the agent sat out; a quiet bar is one the generator filled in its place.`;
  }
}

function unitOf(numbers: SummaryNumbers): string | null {
  if (numbers.records === 0) return null;
  const parts = [
    // NOT AN EQUALITY. A session where an agent joined late has fewer records than room bars (the
    // live judge drew 13 records across 19 bars), and a session with a `late` patch has more records
    // than slots. The relation is "one record per agent per bar", never "records equal bars", so both
    // figures are stated and the rule joining them is said in words.
    numbers.roomBars === null
      ? 'A bar carries one record per agent.'
      : `The session ran ${numbers.roomBars} room bars and made ${numbers.records} agent-bar records: one record per agent per bar.`,
  ];
  if (numbers.latePatches > 0) {
    parts.push(
      `${numbers.latePatches} late ${numbers.latePatches === 1 ? 'patch was' : 'patches were'} the model's line played into the rest of a bar, so ${numbers.latePatches === 1 ? 'it is' : 'they are'} not counted above.`,
    );
  }
  return parts.join(' ');
}

/**
 * The whole card, from the recorder's snapshot alone. Pure: no clock, no DOM, no side effect, so a
 * test can hold it to every number the panel prints.
 */
export function summarize(input: SessionSummaryInput): SessionSummary {
  const state = stateOf(input);
  const numbers = numbersOf(input.bars, input.recordedMs, input.bpm);
  const agents = agentsOf(input.bars);

  // the reason is the LATEST failing record's own words, printed verbatim: the export carries the
  // string and the panel must not paraphrase it
  const failing = input.bars.filter((row) => sourceOf(row) !== 'late' && readString(row.error) !== null);
  const reason = failing.length > 0 ? readString(failing[failing.length - 1]?.error) : null;

  const populated = state === 'one' || state === 'many' || state === 'error';
  const chips = populated ? chipsOf(input.bars) : [];

  return {
    state,
    stateLabel: stateLabelOf(state, agents),
    tag: tagOf(state, input.recordedMs, input.bpm),
    rows: populated ? rowsOf(numbers, reason) : [],
    chips,
    sentence: sentenceOf(state, numbers, agents),
    legend: chips.length > 0
      ? `${legendOf(chips)}${numbers.records > MAX_CHIPS ? ` Showing the last ${MAX_CHIPS} of ${numbers.records} records.` : ''}`
      : null,
    unit: populated ? unitOf(numbers) : null,
    agents,
    numbers,
  };
}

function stateLabelOf(state: SessionState, agents: ReadonlyArray<string>): string {
  switch (state) {
    case 'empty': return 'nothing played yet';
    case 'signed out': return 'signed out';
    case 'error': return 'a render fell back';
    case 'many': return `${Math.max(agents.length, 2)} agents`;
    case 'one':
    default: return 'one agent';
  }
}
