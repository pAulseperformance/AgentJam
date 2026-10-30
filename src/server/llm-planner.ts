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

import { generateMeasure, type GeneratedNote, type AgentStyle } from '@/shared/music';
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
  source: 'llm' | 'pattern' | 'fallback' | 'rest';
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

function buildUserPrompt(ctx: MeasureContext, brief: DecisionBrief | null): string {
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
      `AMOUNT: ${DENSITY_RULE[brief.density]} ${REGISTER_RULE[brief.register]}`,
    );
  }

  if (ctx.peerPlan) {
    lines.push(`ANOTHER AGENT IS ABOUT TO PLAY THIS BAR: ${ctx.peerPlan}. Answer it or leave room for it, never copy it.`);
  }
  if (ctx.heldNotes?.length) {
    lines.push(`DO NOT PLAY (someone is holding these): ${ctx.heldNotes.join(', ')}`);
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

/** How long a render may block a measure's slot before the pattern generator takes over. */
const AI_BUDGET_MS = 2500;

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
): Promise<MeasureResult> {
  const prompt = buildUserPrompt(ctx, brief);
  const decider = brief ? 'jev' : 'none';
  const pattern = () => shrinkToDensity(generateMeasure(ctx.style, ctx.key, ctx.bpm), brief?.density ?? 'dense');

  // Jev says the room is crowded: rest, and say so, rather than invent a silent-failure story.
  if (brief && !brief.play) {
    return {
      notes: [],
      meta: {
        source: 'rest', tier, model, decider, brief, prompt,
        response: '(rest, Jev judged the room crowded)',
        noteCount: 0, latencyMs: brief.latencyMs,
      },
    };
  }

  // An agent set to 'none' is a deliberate pattern agent, not a broken one.
  if (model === 'none' || !ai) {
    const notes = pattern();
    return {
      notes,
      meta: {
        source: 'pattern', tier, model, decider, brief, prompt,
        response: model === 'none' ? '(pattern agent, no model)' : '(no AI binding, using pattern generator)',
        noteCount: notes.length, latencyMs: 0,
      },
    };
  }

  const startTime = Date.now();
  try {
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
        setTimeout(() => reject(new Error(`AI call exceeded ${budgetMs}ms`)), budgetMs)),
    ]);

    const latencyMs = Date.now() - startTime;
    const rawResponse = result.response;

    const notes = parseAiResponse(rawResponse);
    if (notes) {
      return {
        notes,
        meta: {
          source: 'llm', tier, model, decider, brief, prompt,
          response: describeResponse(rawResponse),
          noteCount: notes.length, latencyMs,
        },
      };
    }

    const fallbackNotes = pattern();
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback', tier, model, decider, brief, prompt,
        response: describeResponse(rawResponse) || '(empty response)',
        noteCount: fallbackNotes.length, latencyMs,
        error: 'Failed to parse AI response',
      },
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const fallbackNotes = pattern();
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback', tier, model, decider, brief, prompt,
        response: '(AI call failed)',
        noteCount: fallbackNotes.length, latencyMs,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    };
  }
}
