import { describe, it, expect, vi } from 'vitest';
import {
  generateMeasureWithAi,
  parseAiResponse,
  askShape,
  CELL_ASK,
  type MeasureContext,
  type DecisionBrief,
} from './llm-planner';
import { FREE_MODEL } from '@/shared/ai/models';

describe('LLM Planner', () => {
  const mockCtx: MeasureContext = {
    key: 'C major',
    bpm: 120,
    style: 'jazz',
    recentNotes: [
      { pitch: 'C4', peerId: '1', beatTime: 0 },
      { pitch: 'E4', peerId: '1', beatTime: 1 },
    ],
    currentBeat: 0,
  };

  const brief: DecisionBrief = {
    role: 'answer', relation: 'vary', density: 'sparse', register: 'low', play: true, latencyMs: 240,
  };

  it('returns source: pattern if no AI binding is provided', async () => {
    const result = await generateMeasureWithAi(undefined, mockCtx);
    expect(result.meta.source).toBe('pattern');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('returns parsed notes on happy path', async () => {
    const aiBinding = {
      run: vi.fn().mockResolvedValue({
        response: '[{"pitch": "G4", "beatTime": 0, "velocity": 80, "duration": 1}]'
      }),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx);

    expect(result.meta.source).toBe('llm');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toEqual({ pitch: 'G4', beatTime: 0, velocity: 80, duration: 1 });
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.prompt).toContain('Key: C major');
  });

  // THE DEFECT THAT SILENCED EVERY LIVE MODEL (2026-10-29): the response arrives already parsed,
  // and the old parser called .trim() on it. Measured on llama-3.2-3b / 3.3-70b / llama-4-scout.
  it('accepts an already-parsed note array, not only a JSON string', async () => {
    const aiBinding = {
      run: vi.fn().mockResolvedValue({
        response: [{ pitch: 'E4', beatTime: 0, velocity: 100, duration: 0.25 }],
      }),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx);

    expect(result.meta.source).toBe('llm');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.pitch).toBe('E4');
    expect(typeof result.meta.response).toBe('string');
  });

  it('unwraps a response nested under response/notes', () => {
    expect(parseAiResponse({ response: [{ pitch: 'C4', beatTime: 0, velocity: 80, duration: 0.5 }] }))
      .toHaveLength(1);
    expect(parseAiResponse({ notes: [{ pitch: 'D4', beatTime: 1, velocity: 80, duration: 0.5 }] }))
      .toHaveLength(1);
  });

  // MEASURED ON THE LIVE ROUTE (2026-10-29, llama-3.2-3b): the note JSON arrives stringified inside a
  // single array element, so every fifth measure was falling back to the pattern generator.
  it('unwraps JSON text that arrived inside an array element', () => {
    const payload = [
      '{"pitch":"E4","beatTime":0.25,"velocity":100,"duration":0.5},{"pitch":"G4","beatTime":0.75,"velocity":90,"duration":0.75}',
    ];
    const notes = parseAiResponse(payload);
    expect(notes).toHaveLength(2);
    expect(notes?.map(n => n.pitch)).toEqual(['E4', 'G4']);
  });

  it('unwraps a JSON array that arrived as one string element', () => {
    const payload = ['[{"pitch":"E4","beatTime":0.25,"velocity":100,"duration":0.5},{"pitch":"C4","beatTime":1,"velocity":90,"duration":0.5}]'];
    const notes = parseAiResponse(payload);
    expect(notes).toHaveLength(2);
    expect(notes?.[0]?.pitch).toBe('E4');
  });

  // MEASURED ON THE LIVE ROUTE (2026-10-29): llama-3.2-3b answered a whole measure as compact
  // `pitch@beat` tokens rather than note objects.
  it('reads a measure written as compact pitch@beat tokens', () => {
    const notes = parseAiResponse(['E4@1.0', 'G#4@0.25', 'A3@2.75']);
    expect(notes).toHaveLength(3);
    expect(notes?.[0]).toEqual({ pitch: 'E4', beatTime: 1, velocity: 90, duration: 0.5 });
    expect(notes?.[2]?.beatTime).toBe(2.75);
  });

  it('reads compact tokens that arrive inside a JSON string element', () => {
    const notes = parseAiResponse(['["C4@0.5","D4@1.5"]']);
    expect(notes?.map(n => n.pitch)).toEqual(['C4', 'D4']);
  });

  // MEASURED ON THE LIVE ROUTE (2026-10-29): the model emitted `[{"{"pitch":...}`, braces lost,
  // every note still inside it.
  it('recovers the notes from a malformed envelope instead of dropping the measure', () => {
    const broken = '[{"{\"pitch\":\"E4\",\"beatTime\":0.5,\"velocity\":90,\"duration\":0.5},'
      + '{"{\"pitch\":\"F4\",\"beatTime\":0.75,\"velocity\":110,\"duration\":0.25}]';
    const notes = parseAiResponse(broken);
    expect(notes?.map(n => n.pitch)).toEqual(['E4', 'F4']);
    expect(notes?.[0]?.beatTime).toBe(0.5);
    expect(notes?.[1]?.velocity).toBe(110);
  });

  it('coerces numbers the model wrote as strings, and defaults a missing duration', () => {
    const notes = parseAiResponse([{ pitch: 'D4', beatTime: '1.5', velocity: '96' }]);
    expect(notes?.[0]).toEqual({ pitch: 'D4', beatTime: 1.5, velocity: 96, duration: 0.5 });
  });

  it('salvages JSON that a model wrapped in prose', () => {
    const notes = parseAiResponse('Sure! Here it is: [{"pitch":"A4","beatTime":2,"velocity":70,"duration":1}] enjoy');
    expect(notes).toHaveLength(1);
    expect(notes?.[0]?.pitch).toBe('A4');
  });

  it('falls back if AI returns garbage text', async () => {
    const aiBinding = {
      run: vi.fn().mockResolvedValue({
        response: 'Here are some cool jazz notes! Enjoy!'
      }),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx);

    expect(result.meta.source).toBe('fallback');
    expect(result.meta.error).toBe('Failed to parse AI response');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('falls back if AI throws an error', async () => {
    const aiBinding = {
      run: vi.fn().mockRejectedValue(new Error('Rate limited')),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx);

    expect(result.meta.source).toBe('fallback');
    expect(result.meta.error).toBe('Rate limited');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('frees the measure when the binding never answers (a hung call must not silence the agent)', async () => {
    const aiBinding = { run: vi.fn().mockReturnValue(new Promise(() => { /* never settles */ })) };

    const result = await generateMeasureWithAi(aiBinding, mockCtx, FREE_MODEL, null, 'public', 40);

    expect(result.meta.source).toBe('fallback');
    expect(result.meta.error).toContain('exceeded 40ms');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('carries the retirement error verbatim instead of hiding it', async () => {
    const aiBinding = {
      run: vi.fn().mockRejectedValue(new Error('5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated')),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx, '@cf/meta/llama-3.1-8b-instruct');

    expect(result.meta.source).toBe('fallback');
    expect(result.meta.error).toContain('5028');
  });

  it('strips markdown fences from AI response', async () => {
    const aiBinding = {
      run: vi.fn().mockResolvedValue({
        response: '```json\n[{"pitch": "F4", "beatTime": 0.5, "velocity": 90, "duration": 0.5}]\n```'
      }),
    };

    const result = await generateMeasureWithAi(aiBinding, mockCtx);

    expect(result.meta.source).toBe('llm');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.pitch).toBe('F4');
  });

  describe('with a Jev brief', () => {
    it('passes the brief into the prompt and reports the decider', async () => {
      const run = vi.fn().mockResolvedValue({
        response: [{ pitch: 'C4', beatTime: 0, velocity: 80, duration: 0.5 }],
      });

      const result = await generateMeasureWithAi({ run }, mockCtx, FREE_MODEL, brief, 'signed');

      expect(result.meta.decider).toBe('jev');
      expect(result.meta.tier).toBe('signed');
      expect(result.meta.prompt).toContain('YOUR MOVE: answer');
      expect(result.meta.prompt).toContain('RELATION: vary');
      expect(result.meta.prompt).toContain('2-4 notes');
    });

    it('rests the measure when the decision says rest, without calling the model', async () => {
      const run = vi.fn();
      const vetoed: DecisionBrief = { ...brief, role: 'rest', play: false };

      const result = await generateMeasureWithAi({ run }, mockCtx, FREE_MODEL, vetoed, 'signed');

      expect(run).not.toHaveBeenCalled();
      expect(result.meta.source).toBe('rest');
      expect(result.notes).toHaveLength(0);
    });

    it('keeps the brief when the model fails, shrinking the pattern to the judged density', async () => {
      const run = vi.fn().mockRejectedValue(new Error('timeout'));
      const full = await generateMeasureWithAi(undefined, mockCtx);
      const shrunk = await generateMeasureWithAi({ run }, mockCtx, FREE_MODEL, brief, 'signed');

      expect(shrunk.meta.source).toBe('fallback');
      expect(shrunk.meta.decider).toBe('jev');
      expect(shrunk.notes.length).toBeLessThanOrEqual(4);
      expect(shrunk.notes.length).toBeLessThanOrEqual(full.notes.length);
    });
  });

  it('treats model "none" as a deliberate pattern agent', async () => {
    const run = vi.fn();
    const result = await generateMeasureWithAi({ run }, mockCtx, 'none');
    expect(run).not.toHaveBeenCalled();
    expect(result.meta.source).toBe('pattern');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  // TASK 4, THE TAIL WILL NOT FIT. At 200 BPM a bar is 1200 ms and a signed render's tail is about
  // 1800 ms (Jev ~400 + model ~1400): asking for a bar writes an answer that arrives after its own
  // line. The ask becomes two notes in one named slot instead.
  describe('a paced agent whose tail will not fit the bar it writes', () => {
    const paced: MeasureContext = {
      ...mockCtx,
      bpm: 200,
      stride: 2,
      tailMs: 1800,
      windowMs: 1200,
      cellSlot: 2,
    };

    it('asks for two notes in the named slot instead of a bar, and plays only those', async () => {
      // THE MODEL OVER-ANSWERS with three notes on three beats; the room named beat 2, so the extra
      // note is dropped, both survivors land on the slot, and the stray C# is tidied into C major.
      const run = vi.fn().mockResolvedValue({
        response: [
          { pitch: 'C#4', beatTime: 0.5, velocity: 96, duration: 1 },
          { pitch: 'G4', beatTime: 3, velocity: 88, duration: 0.25 },
          { pitch: 'B4', beatTime: 3.5, velocity: 70, duration: 0.25 },
        ],
      });

      const result = await generateMeasureWithAi({ run }, paced, FREE_MODEL, brief, 'signed');

      // THE PROMPT IS THE ASK: the mutation this card names (always ask for a bar) fails right here.
      expect(result.meta.prompt).toContain(CELL_ASK);
      expect(result.meta.prompt).toContain('beatTime 2.00');
      expect(result.meta.prompt).not.toContain('AMOUNT:');
      expect(result.meta.prompt).toContain('below C4');

      expect(result.meta.ask).toBe('cell');
      expect(result.meta.source).toBe('llm');
      expect(result.meta.noteCount).toBe(2);
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map(n => n.beatTime)).toEqual([2, 2]);
      expect(result.notes.map(n => n.pitch)).toEqual(['C4', 'G4']);
      expect(result.notes.every(n => n.duration === 0.5)).toBe(true);
    });

    it('asks for a bar when the tail fits the bar window', async () => {
      const run = vi.fn().mockResolvedValue({
        response: [{ pitch: 'E4', beatTime: 0.5, velocity: 90, duration: 0.5 }],
      });

      const result = await generateMeasureWithAi(
        { run }, { ...paced, tailMs: 900 }, FREE_MODEL, brief, 'signed',
      );

      expect(result.meta.prompt).not.toContain(CELL_ASK);
      expect(result.meta.prompt).toContain('AMOUNT:');
      expect(result.meta.prompt).toContain('Write the bar now');
      expect(result.meta.ask).toBe('bar');
      expect(result.notes[0]?.beatTime).toBe(0.5);
    });

    it('asks for a bar at a stride of one, where the room has said a bar holds a render', async () => {
      const run = vi.fn().mockResolvedValue({
        response: [{ pitch: 'A4', beatTime: 1, velocity: 90, duration: 0.5 }],
      });

      const result = await generateMeasureWithAi(
        { run }, { ...paced, stride: 1 }, FREE_MODEL, brief, 'signed',
      );

      expect(result.meta.ask).toBe('bar');
      expect(result.meta.prompt).not.toContain(CELL_ASK);
    });

    it('still answers the cell when the model fails: two notes in the slot, never silence', async () => {
      const run = vi.fn().mockRejectedValue(new Error('timeout'));

      const result = await generateMeasureWithAi({ run }, paced, FREE_MODEL, brief, 'signed');

      expect(result.meta.source).toBe('fallback');
      expect(result.meta.ask).toBe('cell');
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map(n => n.beatTime)).toEqual([2, 2]);
    });

    it('shapes no cell ask without both numbers', () => {
      const { stride, tailMs, windowMs } = paced;
      expect(askShape({ stride, tailMs, windowMs })).toBe('cell');
      expect(askShape({ stride, windowMs })).toBe('bar');
      expect(askShape({ tailMs, windowMs })).toBe('bar');
    });
  });
});
