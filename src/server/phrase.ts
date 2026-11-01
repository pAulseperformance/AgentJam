/**
 * THE PHRASE ASK: one model call that writes four bars instead of four calls that each write one.
 *
 * Measured (tools/phrase-probe.ts, 8 phrases, llama-3.2-3b, FINDINGS 2026-11-01): with the room's full
 * per-bar chain applied to both arms, the one-phrase answer is 6.0 notes per bar against 5.4, a line in
 * 26 of 32 bars against 24, and ends on a chord tone 7 of 8 against 5 of 8, at three points less
 * stepwise motion. It is also four times fewer calls, which is the column that matters at tempo.
 *
 * WHAT ARRIVES IS OFTEN NOT VALID JSON: in the probe run 8 of 8 four-bar answers were truncated or
 * carried a malformed bracket between two bars, and one lost two of its four bars. So the parse here is
 * bar-level, not envelope-level: the notes are read out of the text and grouped by the bar line, which
 * is where a phrase restarts (the beatTime goes back toward zero). A malformed phrase then costs its
 * syntax, not its music.
 */

import type { GeneratedNote } from '@/shared/music';

/** A bar of a phrase: always four entries, some of them possibly empty. */
export type PhraseBars = GeneratedNote[][];

const PITCH = /^[A-G][#b]?\d$/;

function noteFrom(value: unknown): GeneratedNote | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const pitch = typeof o.pitch === 'string' ? o.pitch.trim() : '';
  if (!PITCH.test(pitch)) return null;
  const beatTime = Number(o.beatTime);
  if (!Number.isFinite(beatTime) || beatTime < 0 || beatTime > 4.5) return null;
  const velocity = Number.isFinite(Number(o.velocity)) ? Number(o.velocity) : 90;
  const duration = Number.isFinite(Number(o.duration)) ? Number(o.duration) : 0.5;
  return { pitch, beatTime, velocity, duration };
}

/** Every note written in the text, in the order it was written, envelope or no envelope. */
function looseNotes(text: string): GeneratedNote[] {
  const out: GeneratedNote[] = [];
  for (const chunk of text.split('{').slice(1)) {
    const pitch = /"pitch"\s*:\s*"([^"]+)"/.exec(chunk)?.[1];
    if (!pitch) continue;
    const beat = Number(/"beatTime"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? NaN);
    if (!Number.isFinite(beat)) continue;
    const velocity = Number(/"velocity"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 90);
    const duration = Number(/"duration"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 0.5);
    const note = noteFrom({ pitch, beatTime: beat, velocity, duration });
    if (note) out.push(note);
  }
  return out;
}

/** Group a phrase's notes into bars: a bar starts where the beatTime goes back toward zero. */
function groupIntoBars(notes: GeneratedNote[]): PhraseBars {
  const bars: PhraseBars = [[], [], [], []];
  let index = 0;
  let previous = -1;
  for (const note of notes) {
    if (index < bars.length - 1 && previous >= 0 && note.beatTime < previous - 1e-9) index++;
    bars[index]!.push(note);
    previous = note.beatTime;
  }
  return bars;
}

/**
 * Read a four-bar answer. JSON first, then the same text with the brackets closed (a truncated answer
 * ends mid-object), then the notes read out of whatever is there and grouped by the bar line.
 */
export function parsePhraseResponse(text: string): PhraseBars | null {
  const cleaned = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  const objStart = cleaned.indexOf('{');
  const attempt = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };

  const fromObject = (json: unknown): PhraseBars | null => {
    const bars = (json as { bars?: unknown } | null)?.bars;
    if (!Array.isArray(bars)) return null;
    const out: PhraseBars = [[], [], [], []];
    bars.slice(0, 4).forEach((raw, i) => {
      if (Array.isArray(raw)) out[i] = raw.map(noteFrom).filter((n): n is GeneratedNote => n !== null);
    });
    // A BAR'S NOTES RUN FORWARD IN TIME. An envelope that closed in the wrong place puts bar two's
    // notes inside bar one, and the only trace is a beatTime that goes backwards: that answer is not
    // a four-bar phrase with four notes in its first bar, it is a broken envelope, so it falls through
    // to the grouping below.
    const ordered = out.every(bar => bar.every((n, i) => i === 0 || n.beatTime >= bar[i - 1]!.beatTime - 1e-9));
    if (!ordered) return null;
    return out.some(b => b.length > 0) ? out : null;
  };

  const whole = fromObject(attempt(cleaned));
  if (whole) return whole;

  // THE BAR LINE IS MORE RELIABLE THAN THE ENVELOPE. A truncated answer is recoverable note by note,
  // and a malformed one (`]],[[` between two bars) parses into a shape that looks fine and has two
  // bars filed as one: measured, a repaired envelope read that answer as 4 and 3 notes where the bars
  // really were 2, 2, 2 and 1. So an answer that is not valid JSON as written is grouped by where its
  // beatTime resets, and the repaired envelope is only the last resort.
  const grouped = groupIntoBars(looseNotes(text));
  if (grouped.some(b => b.length > 0)) return grouped;

  const closed = closeTruncated(cleaned.slice(Math.max(0, objStart)));
  if (closed) {
    const repaired = fromObject(attempt(closed));
    if (repaired) return repaired;
  }
  return null;
}

/** Close the brackets a cut answer left open, stopping at the last complete note. */
function closeTruncated(text: string): string | null {
  let inString = false; let escape = false; let lastClose = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString && ch === '}') lastClose = i;
  }
  if (lastClose === -1) return null;
  const head = text.slice(0, lastClose + 1);
  const stack: string[] = [];
  inString = false; escape = false;
  for (const ch of head) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ']' || ch === '}') stack.pop();
  }
  let out = head;
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '[' ? ']' : '}';
  return out;
}

/** The four sentences the per-bar asks carry, as one instruction for one phrase. */
export const PHRASE_ARC = [
  'BAR 1 of 4 states the idea: clear and simple, moving up then down, and worth repeating.',
  'BAR 2 of 4 repeats bar 1 with ONE change (a different rhythm, or one note moved), so a listener hears it come back.',
  'BAR 3 of 4 develops it: same shape, different notes, reaching further than the first statement.',
  'BAR 4 of 4 lands it: fewer notes, ending somewhere the next phrase can start.',
] as const;

/** What the model is asked for, on top of the room's own state lines. */
export function phraseInstruction(): string {
  return [
    'WRITE ONE PHRASE OF FOUR BARS, not four separate bars: one idea, stated then developed.',
    ...PHRASE_ARC,
    'Most moves should be one or two scale steps, not jumps across the chord.',
    '6 to 8 notes in bars 1 to 3, 2 to 4 notes in bar 4. Stay inside the register below.',
    'Output ONLY a JSON object with four arrays, one per bar, beatTime 0.0 to 3.99 inside each bar:',
    '{"bars":[[{"pitch":"C4","beatTime":0,"velocity":80,"duration":0.5}],[{"pitch":"Eb4","beatTime":1,"velocity":80,"duration":0.5}],[],[]]}',
    'Exactly 4 arrays. ONLY the JSON, no words.',
  ].join('\n');
}
