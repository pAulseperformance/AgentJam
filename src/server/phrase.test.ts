/**
 * THE PHRASE PARSER, against the three shapes measured on the live route (tools/phrase-probe.ts, 8
 * phrases at 130 to 160 BPM, llama-3.2-3b): a clean object, an answer cut on its closing brace, and an
 * answer that wrote `]],[[` between two bars.
 *
 * Each fixture restarts its bars at beatTime 0, which is the prompt's contract (beatTime 0 to 3.99
 * inside a bar) and what makes the bar line recoverable at all: a phrase whose bars did not restart
 * could not be grouped by time.
 */
import { describe, expect, it } from 'vitest';
import { parsePhraseResponse } from './phrase';

const note = (pitch: string, beatTime: number) => `{"pitch":"${pitch}","beatTime":${beatTime},"velocity":80,"duration":0.5}`;

describe('parsePhraseResponse', () => {
  it('reads four arrays out of a clean object', () => {
    const text = `{"bars":[[${note('C4', 0)},${note('D#4', 1)}],[${note('G4', 0)}],[],[${note('C4', 0)}]]}`;
    expect(parsePhraseResponse(text)?.map(b => b.length)).toEqual([2, 1, 0, 1]);
    expect(parsePhraseResponse(text)?.[0]?.[0]?.pitch).toBe('C4');
  });

  it('keeps the bars a truncated answer wrote instead of losing the phrase', () => {
    // MEASURED: at a 1400-token budget the model wrote all four bars and ran out of room on the final
    // brace. Everything before it is music.
    const text = `{"bars":[[${note('C4', 0)},${note('D#4', 1)}],[${note('G4', 0)},${note('A#4', 1)}],[${note('C4', 0)},${note('F4', 1)}],[${note('A#3', 0)}`;
    const bars = parsePhraseResponse(text);
    expect(bars).not.toBeNull();
    expect(bars!.filter(b => b.length > 0).length).toBe(4);
  });

  it('groups by the bar line when the brackets are wrong', () => {
    // MEASURED: `]],[[` between bars two and three, so no envelope parse can succeed. A repaired
    // envelope read this answer as 4 and 3 notes; the bars really are 2, 2, 2 and 1.
    const text = `{"bars":[[${note('C4', 0)},${note('D#4', 1)}],[${note('G4', 0)},${note('A#4', 1)}]],[[${note('C4', 0)},${note('F4', 1)}],[${note('C4', 0)}]]}`;
    expect(parsePhraseResponse(text)?.map(b => b.length)).toEqual([2, 2, 2, 1]);
  });

  it('answers null when there is no note in the text at all', () => {
    expect(parsePhraseResponse('I am sorry, I cannot play that.')).toBeNull();
  });
});
