/**
 * LLM Planner — Uses Cloudflare Workers AI to generate context-aware
 * musical responses based on what peers are currently playing.
 *
 * TAS-113: LLM-Powered Agent + AI Observability
 *
 * Returns both notes AND metadata (prompt, response, timing, source)
 * so the client can display what the AI is "thinking."
 */

import { generateMeasure, type GeneratedNote, type AgentStyle } from '@/shared/music';

// Env type for Workers AI binding
interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<{ response?: string }>;
}

export interface MeasureContext {
  key: string;
  bpm: number;
  style: AgentStyle;
  recentNotes: Array<{ pitch: string; peerId: string; beatTime: number }>;
  currentBeat: number;
}

/** Metadata returned alongside notes for observability */
export interface AiCallMeta {
  source: 'llm' | 'pattern' | 'fallback';
  model: string;
  prompt: string;
  response: string;
  noteCount: number;
  latencyMs: number;
  error?: string;
}

export interface MeasureResult {
  notes: GeneratedNote[];
  meta: AiCallMeta;
}

/** Available Workers AI models for music generation */
export const AI_MODELS = [
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', tier: 'fast' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tier: 'quality' },
  { id: '@cf/google/gemma-7b-it-lora', label: 'Gemma 7B', tier: 'fast' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2-lora', label: 'Mistral 7B', tier: 'fast' },
] as const;

export type AiModelId = typeof AI_MODELS[number]['id'];

const SYSTEM_PROMPT = `You are a musical AI agent in a collaborative jam room. You generate MIDI-like note sequences that complement what other musicians are playing.

RULES:
- Output ONLY a JSON array of note objects: [{"pitch": "C4", "beatTime": 0.0, "velocity": 80, "duration": 0.5}, ...]
- Use standard pitch notation: C3, D#4, Bb5, etc.
- beatTime is in beats (0.0 to 3.99 for a 4-beat measure)
- velocity is 1-127
- duration is in beats (0.25 = sixteenth, 0.5 = eighth, 1.0 = quarter)
- Generate 4-12 notes per measure
- Stay in the given key
- Complement what others are playing — don't play the same notes
- Match the style (jazz = swing + 7th chords, ambient = long drones, funk = syncopated 16ths)
- NO text, NO markdown, NO explanation — ONLY the JSON array`;

function buildUserPrompt(ctx: MeasureContext): string {
  const recentSummary = ctx.recentNotes.length > 0
    ? ctx.recentNotes.slice(-20).map(n => `${n.pitch}@${n.beatTime.toFixed(1)}`).join(', ')
    : 'silence (be the first to play!)';

  return `Key: ${ctx.key} | BPM: ${ctx.bpm} | Style: ${ctx.style} | Beat: ${ctx.currentBeat}
Recent notes from peers: ${recentSummary}
Generate your next measure:`;
}

function parseAiResponse(response: string): GeneratedNote[] | null {
  try {
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    const notes: GeneratedNote[] = [];
    for (const item of parsed) {
      if (
        typeof item.pitch === 'string' &&
        typeof item.beatTime === 'number' &&
        typeof item.velocity === 'number' &&
        typeof item.duration === 'number'
      ) {
        notes.push({
          pitch: item.pitch,
          beatTime: Math.max(0, Math.min(3.99, item.beatTime)),
          velocity: Math.max(1, Math.min(127, Math.round(item.velocity))),
          duration: Math.max(0.1, Math.min(4, item.duration)),
        });
      }
    }

    return notes.length > 0 ? notes : null;
  } catch {
    return null;
  }
}

/**
 * Generate a measure using Cloudflare Workers AI.
 * Returns notes + full metadata for observability.
 */
export async function generateMeasureWithAi(
  ai: AiBinding | undefined,
  ctx: MeasureContext,
  model: string = '@cf/meta/llama-3.1-8b-instruct',
): Promise<MeasureResult> {
  const prompt = buildUserPrompt(ctx);

  // If no AI binding available, use pattern generator
  if (!ai) {
    const notes = generateMeasure(ctx.style, ctx.key, ctx.bpm);
    return {
      notes,
      meta: {
        source: 'pattern',
        model: 'none',
        prompt,
        response: '(no AI binding — using pattern generator)',
        noteCount: notes.length,
        latencyMs: 0,
      },
    };
  }

  const startTime = Date.now();
  try {
    const result = await ai.run(model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 512,
      temperature: 0.7,
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = result.response ?? '';

    if (rawResponse) {
      const notes = parseAiResponse(rawResponse);
      if (notes) {
        return {
          notes,
          meta: {
            source: 'llm',
            model,
            prompt,
            response: rawResponse,
            noteCount: notes.length,
            latencyMs,
          },
        };
      }
    }

    // AI returned unparseable response — fallback
    const fallbackNotes = generateMeasure(ctx.style, ctx.key, ctx.bpm);
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback',
        model,
        prompt,
        response: rawResponse || '(empty response)',
        noteCount: fallbackNotes.length,
        latencyMs,
        error: 'Failed to parse AI response',
      },
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const fallbackNotes = generateMeasure(ctx.style, ctx.key, ctx.bpm);
    return {
      notes: fallbackNotes,
      meta: {
        source: 'fallback',
        model,
        prompt,
        response: '(AI call failed)',
        noteCount: fallbackNotes.length,
        latencyMs,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    };
  }
}
