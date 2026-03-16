import { describe, it, expect, vi } from 'vitest';
import { generateMeasureWithAi, type MeasureContext } from './llm-planner';

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

  it('returns source: pattern if no AI binding is provided', async () => {
    const result = await generateMeasureWithAi(undefined, mockCtx);
    expect(result.meta.source).toBe('pattern');
    expect(result.notes.length).toBeGreaterThan(0); // from fallback generator
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
});
