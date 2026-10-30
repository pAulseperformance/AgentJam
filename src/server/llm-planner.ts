/**
 * LLM Planner, writes one measure of notes for an in-process agent.
 *
 * Two measured facts shape this file (2026-10-29, probe on the live room):
 *
 * 1. Workers AI RETIRED the model this app shipped with. `@cf/meta/llama-3.1-8b-instruct` maps to
 *    `@cf/meta/infire-llama-3.1-8b-instruct`, which answers 5028 "deprecated on 2026-05-30". Every
 *    measure fell back to the pattern generator, so the "AI" agent had not been an LLM for months.
 *
 * 2. The response envelope is NOT always text. Current chat models return the note array already
 *    parsed, so `result.response` is an `object[]`; the old parser called `.trim()` on it, threw, and
 *    fell back. Both defects had to be fixed for any model to be audible.
 *
 * The planner is split in three parts, per the Jev rule ("code calculates state, a model interprets
 * state, code applies policy"):
 *   - state is assembled here,
 *   - an optional decision brief (Jev) says WHAT to play, never which notes,
 *   - the renderer turns that into notes, and a deterministic pattern covers any failure.
 */

import { generateMeasure, midiOf, snapPitchToKey, type GeneratedNote, type AgentStyle } from '@/shared/music';
import { FREE_MODEL } from '@/shared/ai/models';

export { AI_MODELS, FREE_MODEL, SIGNED_MODEL, isFreeModel, isKnownModel } from '@/shared/ai/models';
export type { AgentModel, ModelTier } from '@/shared/ai/models';

// Env type for Workers AI binding
interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<{ response?: unknown }>;
}

export interface MeasureContext {
  key: string;
  bpm: number;
  style: AgentStyle;
  recentNotes: Array<{ pitch: string; peerId: string; beatTime: number }>;
  currentBeat: number;
  /** the listener's summary of what the room is playing, already in words */
  phrase?: string;
  /** the agent's own last statement, so it can restate or vary it instead of starting over */
  motif?: string;
  /** pitches still held by someone else, so the bar does not double them */
  heldNotes?: string[];
  /** what ANOTHER AGENT has already queued for this bar, so two agents do not play the same line */
  peerPlan?: string;
  /** the phrase arc this bar sits in, in plain words, so the model writes a melody and not a chord */
  melody?: string;
  /**
   * THE TAIL-AWARE ASK, as two numbers the room measures. `tailMs` is the worst render this agent has
   * recently paid (the decision layer plus the model); `windowMs` is the window the ask writes for:
   * ONE BAR. An ask produces one bar of music, so a tail longer than that bar cannot be trusted to
   * deliver a bar-shaped answer on the bar's own grid.
   */
  tailMs?: number;
  windowMs?: number;
  /** how many bars this agent writes one bar of music: 1 while one bar holds a render, above 1 when paced */
  stride?: number;
  /** the beat a cell ask names, chosen by the room on the bar's eighth grid, away from the downbeat */
  cellSlot?: number;
}

/** Who is playing: an anonymous visitor, or someone the zpe door knows. */
export type Tier = 'public' | 'signed';

/**
 * The judgement a text model cannot make for itself: how much to play, and where on the keyboard.
 * Produced by Jev (or absent), then rendered by the model. Values are a closed set so the prompt
 * stays a template and the pattern fallback can honour the same brief.
 */
export type AgentRole = 'lead' | 'answer' | 'ornament' | 'rest';
export type MotifRelation = 'restate' | 'vary' | 'new';

export interface DecisionBrief {
  /**
   * WHAT THIS BAR IS FOR, which is the question a jam partner actually answers: state a line, answer
   * theirs, decorate it, or sit out. Without it every bar was a solo, whatever the room was doing.
   */
  role: AgentRole;
  /** how this bar relates to the agent's own last bar: the difference between a person and a radio */
  relation: MotifRelation;
  density: 'sparse' | 'medium' | 'dense';
  register: 'low' | 'mid' | 'high';
  /** false = the room is crowded, rest this measure */
  play: boolean;
  latencyMs: number;
}

/** Metadata returned alongside notes for observability */
export interface AiCallMeta {
  /**
   * WHO PLAYED THIS BAR. `cell` is the agent's own short figures quoting its last statement, written
   * by the room while a render could not fit the bar; it is not the model's and not the generator's,
   * so it is not counted as either. `late` is the model's own line, played into the eighths still
   * ahead because the answer arrived after the bar's line: it is the model's music, but it is not a
   * bar (see `latePatch` in jam-room.ts).
   */
  source: 'llm' | 'pattern' | 'fallback' | 'rest' | 'cell' | 'late';
  /**
   * WHAT THE ROOM ASKED FOR. A `cell` ask is two notes in one named slot instead of a bar: the
   * agent's tail did not fit the bar the ask writes for, so asking for a whole bar only produced
   * answers that arrived after their own line. A recorded prompt carries the same word (CELL_ASK),
   * which is how a session file proves the ask happened.
   */
  ask?: 'bar' | 'cell';
  tier: Tier;
  model: string;
  /** which layer judged the measure before the renderer wrote it */
  decider: 'jev' | 'none';
  brief: DecisionBrief | null;
  prompt: string;
  /** always a string: the panel renders it, and an array would render as nothing */
  response: string;
  noteCount: number;
  latencyMs: number;
  /**
   * WHAT IT IS ABOUT TO PLAY. ReaLJam's finding is that a human jams better when the machine shows
   * its plan before it plays it (arXiv 2502.21267), because you can anticipate it the way you
   * anticipate a bandmate. The queued bar is already decided, so showing it costs nothing.
   */
  plan?: string;
  /** true when this bar replaced an older render of the SAME bar because something new was played */
  refreshed?: boolean;
  /** notes the melody completion added to a lead bar that arrived too short or too jumpy */
  completed?: number;
  error?: string;
  /**
   * HOW MANY MODEL CALLS THIS BAR SPENT: one normally, two when the room hedged the ask, and zero for
   * a rest or a pattern agent. Recorded on the meta so a probe prices the setting from the session
   * file, rather than from a description of what the setting is supposed to do.
   */
  calls?: number;
}

export interface MeasureResult {
  notes: GeneratedNote[];
  meta: AiCallMeta;
}

const SYSTEM_PROMPT = `You are a musical partner in a collaborative jam room, playing live with a human. You generate MIDI-like note sequences that answer and support what the other musicians are playing. The brief below is binding: honour the move, the relation and the amount.

RULES:
- Output ONLY a JSON array of note objects: [{"pitch": "C4", "beatTime": 0.0, "velocity": 80, "duration": 0.5}, ...]
- Use standard pitch notation: C3, D#4, Bb5, etc.
- beatTime is in beats (0.0 to 3.99 for a 4-beat measure)
- velocity is 1-127
- duration is in beats (0.25 = sixteenth, 0.5 = eighth, 1.0 = quarter)
- Generate 4-12 notes per measure, unless the brief says otherwise
- Stay in the given key
- Complement what others are playing, don't play the same notes
- Match the style (jazz = swing + 7th chords, ambient = long drones, funk = syncopated 16ths)
- NO text, NO markdown, NO explanation, ONLY the JSON array`;

/** What the bar is FOR. This is the part a jam partner answers and a generator never did. */
const ROLE_RULE: Record<DecisionBrief['role'], string> = {
  lead: 'State your own short line; nobody else is carrying the bar.',
  answer: 'Answer the phrase they just played: take at least two of their pitches and play after their phrase, not on top of it.',
  ornament: 'Decorate what they are doing: at most 3 notes, on slots they left open, never on their strong beats.',
  rest: 'Do not play.',
};

const RELATION_RULE: Record<DecisionBrief['relation'], string> = {
  restate: 'Repeat your motif almost exactly, you may move one note.',
  vary: 'Keep two pitches of your motif and change the rhythm or the register.',
  new: 'Drop the old idea and state a new one.',
};

const DENSITY_RULE: Record<DecisionBrief['density'], string> = {
  sparse: 'Play 2-4 notes and leave space.',
  medium: 'Play 5-8 notes.',
  dense: 'Play 9-12 notes and fill the measure.',
};

const REGISTER_RULE: Record<DecisionBrief['register'], string> = {
  low: 'Stay below C4 (bass and low mids).',
  mid: 'Stay between C4 and C5.',
  high: 'Play in the upper register, C5 and above.',
};

/** The marker a cell ask carries in the prompt, so a test, a probe and a reader find the same line. */
export const CELL_ASK = 'CELL ASK';

/** How many notes a cell ask is worth: one short gesture, not a bar. */
export const CELL_NOTES = 2;

/**
 * HOW FAR APART A HEDGED BAR'S TWO CALLS ARE ISSUED, in ms.
 *
 * The tail that misses a bar is one slow call, not a slow provider: measured at 200 BPM (Task 4's
 * probe, 2026-10-30), the same model that answered in 616 ms paid 1403 ms in another run against a
 * 1200 ms bar. Two identical asks, the second issued 200 ms after the first, turn that tail into a
 * race: whichever returns first with a usable line is the bar, and the other call is thrown away.
 * The spend is a room setting and the default is off, so it is the room owner's to turn on.
 */
export const HEDGE_GAP_MS = 200;

/**
 * WHAT TO ASK FOR, from what the room measured.
 *
 * An ask writes ONE bar, so its window is one bar. When the agent's tail (decision layer plus model,
 * worst of the recent renders) is longer than that window AND the room has already paced the agent
 * above a stride of one, a bar-shaped answer cannot be delivered on the bar's own grid: the model is
 * asked for two notes in a named slot instead. A cell asks for 2 notes, which a small model returns
 * in a fraction of the window (plan, 2026-10-30).
 *
 * A stride of one means the room has said a bar holds a render, so the ask stays a bar even when one
 * stale tail reading is long: the tail decays ten percent a render.
 */
export function askShape(ctx: Pick<MeasureContext, 'stride' | 'tailMs' | 'windowMs'>): 'bar' | 'cell' {
  if (!(ctx.stride !== undefined && ctx.stride > 1)) return 'bar';
  if (!(ctx.windowMs !== undefined && ctx.windowMs > 0)) return 'bar';
  if (!(ctx.tailMs !== undefined && ctx.tailMs > 0)) return 'bar';
  return ctx.tailMs > ctx.windowMs ? 'cell' : 'bar';
}

/** The beat a cell ask names: the room's, rounded to the room's sixteenth grid and kept inside the bar. */
function cellSlotOf(ctx: MeasureContext): number {
  const slot = ctx.cellSlot;
  if (typeof slot !== 'number' || !Number.isFinite(slot)) return 2;
  return Math.max(0, Math.min(3.75, Math.round(slot * 4) / 4));
}

/**
 * TWO NOTES IN A NAMED SLOT. The model answers a cell ask with pitches, not with addresses: the room
 * named the beat, so every note lands on it, in the room's key, short and inside the room's range.
 * An unreadable pitch is dropped rather than played; a cell of one note is still a cell.
 */
function shapeCell(notes: GeneratedNote[], ctx: MeasureContext): GeneratedNote[] {
  const slot = cellSlotOf(ctx);
  const out: GeneratedNote[] = [];
  for (const note of [...notes].sort((a, b) => a.beatTime - b.beatTime)) {
    if (out.length >= CELL_NOTES) break;
    if (midiOf(note.pitch) === null) continue;
    out.push({
      pitch: snapPitchToKey(note.pitch, ctx.key),
      beatTime: slot,
      velocity: Math.max(50, Math.min(110, Math.round(note.velocity) || 90)),
      duration: 0.5,
    });
  }
  return out;
}

function buildUserPrompt(ctx: MeasureContext, brief: DecisionBrief | null, ask: 'bar' | 'cell'): string {
  // The old prompt was two lines and a hope: "recent notes: pitch@beat" plus "generate your measure".
  // A 3B model given that writes a plausible bar that ignores the room. This prompt names the job,
  // the phrase it is answering, the idea it is keeping, and what it must not play.
  const recentSummary = ctx.recentNotes.length > 0
    ? ctx.recentNotes.slice(-20).map(n => `${n.pitch}@${n.beatTime.toFixed(2)}`).join(', ')
    : 'silence, be the first to play';

  const lines = [
    `Key: ${ctx.key} | BPM: ${ctx.bpm} | Style: ${ctx.style} | Beat: ${ctx.currentBeat}`,
    `They are playing: ${ctx.phrase ?? recentSummary}`,
    `Your motif from last bar: ${ctx.motif ?? 'none yet'}`,
  ];

  if (ctx.melody) lines.push(ctx.melody);

  if (brief) {
    lines.push(
      `YOUR MOVE: ${brief.role}. ${ROLE_RULE[brief.role]}`,
      `RELATION: ${brief.relation}. ${RELATION_RULE[brief.relation]}`,
    );
    // A CELL ASK DOES NOT TAKE THE AMOUNT RULE: it asks for two notes, and a rule that says five to
    // eight is the wrong answer to that question. The register still applies, below.
    if (ask === 'bar') lines.push(`AMOUNT: ${DENSITY_RULE[brief.density]} ${REGISTER_RULE[brief.register]}`);
  }

  if (ctx.peerPlan) {
    lines.push(`ANOTHER AGENT IS ABOUT TO PLAY THIS BAR: ${ctx.peerPlan}. Answer it or leave room for it, never copy it.`);
  }
  if (ctx.heldNotes?.length) {
    lines.push(`DO NOT PLAY (someone is holding these): ${ctx.heldNotes.join(', ')}`);
  }

  if (ask === 'cell') {
    // THE TAIL WILL NOT FIT: the ask is two notes in ONE named slot, not a bar. The room named the
    // beat, so the model answers with pitches only.
    lines.push(
      `${CELL_ASK}: the window is too short for a bar. Do not write a measure. ` +
      `Write exactly ${CELL_NOTES} notes, BOTH at beatTime ${cellSlotOf(ctx).toFixed(2)}, ` +
      `duration 0.5, nothing at any other beat.`,
    );
    if (brief) lines.push(REGISTER_RULE[brief.register]);
    lines.push('Write the two notes now. ONLY the JSON array, no words.');
    return lines.join('\n');
  }

  lines.push('Write the bar now. ONLY the JSON array, no words.');
  return lines.join('\n');
}

/** A note array is what every measured model returns, as text or already parsed. */
function noteArrayFrom(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    // some models wrap: {response: [...]}, {notes: [...]}, {result: [...]}
    for (const key of ['response', 'notes', 'result', 'data', 'choices']) {
      const inner = o[key];
      if (Array.isArray(inner)) return inner;
    }
    if (typeof o.response === 'string') return noteArrayFrom(o.response);
  }
  return null;
}

/**
 * Read JSON out of text a model produced. Three shapes are needed, all measured on the live route:
 * an object list, an object list that lost its array brackets (the one that broke llama-3.2-3b), and
 * the same wrapped in fences.
 */
function parseLoose(text: string): unknown {
  const cleaned = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* keep looking */ }

  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(cleaned.slice(arrStart, arrEnd + 1)); } catch { /* keep looking */ }
  }

  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(`[${cleaned.slice(objStart, objEnd + 1)}]`); } catch { /* give up */ }
  }
  return undefined;
}

/**
 * Recover notes from JSON that no longer parses: read each `pitch` and the numbers that follow it,
 * independent of the braces that were lost.
 */
function salvageNotes(text: string): GeneratedNote[] | null {
  const notes: GeneratedNote[] = [];
  const chunks = text.split('{');

  for (const chunk of chunks) {
    const pitch = /"pitch"\s*:\s*"([^"]+)"/.exec(chunk)?.[1];
    if (!pitch) continue;
    const beat = Number(/"beatTime"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 0);
    const velocity = Number(/"velocity"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 90);
    const duration = Number(/"duration"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 0.5);
    notes.push({
      pitch,
      beatTime: Math.max(0, Math.min(3.99, Number.isFinite(beat) ? beat : 0)),
      velocity: Math.max(1, Math.min(127, Math.round(Number.isFinite(velocity) ? velocity : 90))),
      duration: Math.max(0.1, Math.min(4, Number.isFinite(duration) ? duration : 0.5)),
    });
  }

  return notes.length > 0 ? notes : null;
}

/** `E4@1.0`, the compact token one model answers with instead of note objects. */
const COMPACT_NOTE = /^([A-Ga-g][#b]?[0-9])@([0-9]*\.?[0-9]+)$/;

/** A number the model wrote as a number, or as a string, or not at all. */
function num(value: unknown, fallback?: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(n)) return n;
  return fallback ?? null;
}

/**
 * Parse a value the model already produced. Two shapes were measured on the live route:
 *   - `[{pitch, beatTime, velocity, duration}, ...]`  (llama-3.3-70b, llama-4-scout)
 *   - `["{\"pitch\":...},{...}"]`                     (llama-3.2-3b, JSON stringified into ONE array
 *                                                      element), this one silently fell back every
 *                                                      fifth measure until it was caught on 2026-10-29.
 * and models omit or stringify numbers often enough that a strict check drops playable notes.
 */
function notesFrom(items: unknown[]): GeneratedNote[] {
  const notes: GeneratedNote[] = [];

  for (const raw of items) {
    // an element that is itself JSON text is unwrapped, not discarded
    if (typeof raw === 'string') {
      // THIRD SHAPE, measured 2026-10-29: the model answers with compact `pitch@beat` tokens
      // (["E4@1.0","G#4@0.25",...]) instead of objects. A whole measure in the wrong notation is
      // still a playable measure, so it is read rather than thrown away.
      const token = COMPACT_NOTE.exec(raw.trim());
      if (token?.[1] && token[2]) {
        notes.push({
          pitch: token[1],
          beatTime: Math.max(0, Math.min(3.99, Number(token[2]) || 0)),
          velocity: 90,
          duration: 0.5,
        });
        continue;
      }
      const inner = parseLoose(raw);
      if (Array.isArray(inner)) { notes.push(...notesFrom(inner)); continue; }
      if (inner && typeof inner === 'object') { pushNote(notes, inner as Record<string, unknown>); }
      continue;
    }
    if (raw && typeof raw === 'object') pushNote(notes, raw as Record<string, unknown>);
  }

  return notes;
}

function pushNote(notes: GeneratedNote[], item: Record<string, unknown>): void {
  const pitch = typeof item.pitch === 'string' ? item.pitch.trim() : '';
  if (!pitch) return;

  const beat = num(item.beatTime, 0);
  const velocity = num(item.velocity, 80);
  const duration = num(item.duration, 0.5);
  if (beat === null || velocity === null || duration === null) return;

  notes.push({
    pitch,
    beatTime: Math.max(0, Math.min(3.99, beat)),
    velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    duration: Math.max(0.1, Math.min(4, duration)),
  });
}

/**
 * Turn whatever the model returned (a string, an already-parsed array, or an envelope around it) into
 * validated notes. Exported so the tests can pin every envelope seen on the live route.
 */
export function parseAiResponse(response: unknown): GeneratedNote[] | null {
  let candidate: unknown = response;

  if (typeof candidate === 'string') {
    // An unparseable answer is NOT a rejection: keep the text so the salvage pass can read the notes
    // out of it. (Returning null here is what threw away a whole measure on the live route.)
    candidate = parseLoose(candidate) ?? response;
  }

  const items = noteArrayFrom(candidate);
  if (items) {
    const notes = notesFrom(items);
    if (notes.length > 0) return notes;
  }

  // LAST RESORT: the JSON is malformed (measured shape: `[{"{"pitch":...}`), but every note is still
  // written in it. Each `pitch` is recovered with the numbers that follow it, which keeps a corrupt
  // envelope from costing the room a whole measure.
  return salvageNotes(typeof response === 'string' ? response : JSON.stringify(candidate));
}

/**
 * How long a render may block a measure's slot before the pattern generator takes over. Exported so
 * the room can cap it against the bar it is writing for: at 160 BPM a bar is 1500ms, and a budget of
 * 2500ms is over by a whole bar.
 */
export const AI_BUDGET_MS = 2500;

/** The panel renders this string; an object or array must not arrive as "[object Object]". */
function describeResponse(response: unknown): string {
  if (typeof response === 'string') return response;
  try { return JSON.stringify(response); } catch { return String(response); }
}

/** Lower the brief's density on a deterministic measure, so a fallback still obeys Jev. */
function shrinkToDensity(notes: GeneratedNote[], density: DecisionBrief['density']): GeneratedNote[] {
  if (density === 'dense') return notes;
  const keep = density === 'sparse' ? Math.min(4, notes.length) : Math.min(8, notes.length);
  return notes.slice(0, keep);
}

/** One model call's answer: its notes when it parsed to something playable, its raw text either way. */
interface Attempt {
  raw: unknown;
  notes: GeneratedNote[] | null;
  latencyMs: number;
}

/** What a (possibly hedged) ask came back with: the winning answer, the text that failed, and its spend. */
interface Answer {
  winner: Attempt | null;
  invalid: Attempt | null;
  error: unknown;
  calls: number;
}

/**
 * FIRST VALID ANSWER WINS.
 *
 * `ask` issues ONE model call and answers with its notes, or null when the answer held no playable
 * note. The first attempt goes out immediately. When `gapMs` is set and no valid answer is in hand,
 * a second identical attempt goes out `gapMs` later; a valid answer clears the pending second call,
 * so a fast model is never billed twice. An invalid answer (a parse failure, a hang, an error) leaves
 * the other attempt to decide the bar, which is the whole point of paying for the pair.
 */
async function firstValidAnswer(ask: () => Promise<Attempt>, gapMs: number): Promise<Answer> {
  let calls = 0;
  let pending = gapMs > 0 ? 1 : 0;
  let inflight = 0;
  let invalid: Attempt | null = null;
  let error: unknown = null;
  let gap: ReturnType<typeof setTimeout> | null = null;

  return new Promise<Answer>((resolve) => {
    const settle = (winner: Attempt | null): void => {
      if (gap !== null) clearTimeout(gap);
      resolve({ winner, invalid, error, calls });
    };

    const launch = (): void => {
      calls += 1;
      inflight += 1;
      ask().then(
        attempt => {
          inflight -= 1;
          if (attempt.notes && attempt.notes.length > 0) { settle(attempt); return; }
          invalid ??= attempt;
          if (pending === 0 && inflight === 0) settle(null);
        },
        failure => {
          inflight -= 1;
          error ??= failure;
          if (pending === 0 && inflight === 0) settle(null);
        },
      );
    };

    launch();
    if (pending > 0) gap = setTimeout(() => { pending = 0; launch(); }, gapMs);
  });
}

/**
 * Generate a measure. `brief` is the Jev judgement when there is one; without it the renderer
 * decides alone (public rooms), and any failure lands on the pattern generator.
 */
export async function generateMeasureWithAi(
  ai: AiBinding | undefined,
  ctx: MeasureContext,
  model: string = FREE_MODEL,
  brief: DecisionBrief | null = null,
  tier: Tier = 'public',
  /** overridable so a test can prove the hang path without waiting the real budget */
  budgetMs: number = AI_BUDGET_MS,
  /**
   * THE HEDGE, IN MILLISECONDS BETWEEN TWO CALLS: 0 (the default) means one call, as before. The
   * room passes HEDGE_GAP_MS when its setting is on; the planner does not decide to spend.
   */
  hedgeMs: number = 0,
): Promise<MeasureResult> {
  const ask = askShape(ctx);
  const prompt = buildUserPrompt(ctx, brief, ask);
  const decider = brief ? 'jev' : 'none';
  const pattern = () => shrinkToDensity(generateMeasure(ctx.style, ctx.key, ctx.bpm), brief?.density ?? 'dense');
  // A FALLBACK ANSWERS THE ASK THAT WAS MADE. A cell ask gets two notes in the named slot, not a
  // generator bar: a failed render still sounds, and it sounds like what was asked for.
  const fallback = () => (ask === 'cell' ? shapeCell(pattern(), ctx) : pattern());

  // Jev says the room is crowded: rest, and say so, rather than invent a silent-failure story.
  if (brief && !brief.play) {
    return {
      notes: [],
      meta: {
        source: 'rest', ask, tier, model, decider, brief, prompt,
        response: '(rest, Jev judged the room crowded)',
        noteCount: 0, latencyMs: brief.latencyMs, calls: 0,
      },
    };
  }

  // An agent set to 'none' is a deliberate pattern agent, not a broken one.
  if (model === 'none' || !ai) {
    const notes = fallback();
    return {
      notes,
      meta: {
        source: 'pattern', ask, tier, model, decider, brief, prompt,
        response: model === 'none' ? '(pattern agent, no model)' : '(no AI binding, using pattern generator)',
        noteCount: notes.length, latencyMs: 0, calls: 0,
      },
    };
  }

  const startTime = Date.now();
  // ONE DEADLINE FOR THE WHOLE ASK, shared by both calls of a hedged bar: the second leaves 200 ms
  // later, so giving it its own full budget would let the pair outlast the bar line by that gap.
  const deadlineMs = startTime + budgetMs;

  /**
   * ONE MODEL CALL, identical to its sibling in every field a model sees: same prompt, same
   * max_tokens, same temperature. It answers with notes only when the text parsed to something
   * playable; a text with no note in it is a failed attempt, not a winner.
   */
  const askModel = async (): Promise<Attempt> => {
    const issuedAt = Date.now();
    const leftMs = Math.max(1, deadlineMs - issuedAt);
    // A HUNG CALL MUST NOT WEDGE THE AGENT. One measure at 120 BPM is 2000ms; a binding that never
    // answers (measured in local dev when the remote AI proxy dropped) would otherwise hold the
    // agent's only slot forever and silence it for the rest of the session.
    const call = ai.run(model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 512,
      temperature: 0.7,
    });
    const result = await Promise.race([
      call,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`AI call exceeded ${leftMs}ms`)), leftMs)),
    ]);

    // A CELL ASK IS ANSWERED AS A CELL: the model is asked for two notes in a named slot, so the
    // extra notes of a model that wrote a whole bar anyway are dropped and both survivors land on
    // the slot the room named. A cell of nothing is a failed attempt, not a cell.
    const parsed = parseAiResponse(result.response);
    const played = parsed === null ? null : ask === 'cell' ? shapeCell(parsed, ctx) : parsed;
    return {
      raw: result.response,
      notes: played && played.length > 0 ? played : null,
      latencyMs: Date.now() - issuedAt,
    };
  };

  try {
    const answer = await firstValidAnswer(askModel, hedgeMs);
    const latencyMs = Date.now() - startTime;

    if (answer.winner?.notes) {
      const played = answer.winner.notes;
      return {
        notes: played,
        meta: {
          source: 'llm', ask, tier, model, decider, brief, prompt,
          response: describeResponse(answer.winner.raw),
          noteCount: played.length, latencyMs, calls: answer.calls,
        },
      };
    }

    const fallbackNotes = fallback();
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback', ask, tier, model, decider, brief, prompt,
        // THE TEXT OF THE FAILED ANSWER, kept whatever the hedge: the first attempt that returned
        // something unreadable is more informative than the word "failed".
        response: answer.invalid
          ? describeResponse(answer.invalid.raw) || '(empty response)'
          : '(AI call failed)',
        noteCount: fallbackNotes.length, latencyMs, calls: answer.calls,
        error: answer.invalid
          ? 'Failed to parse AI response'
          : answer.error instanceof Error ? answer.error.message : 'Unknown error',
      },
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const fallbackNotes = fallback();
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback', ask, tier, model, decider, brief, prompt,
        response: '(AI call failed)',
        noteCount: fallbackNotes.length, latencyMs, calls: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    };
  }
}
