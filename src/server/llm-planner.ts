/**
 * LLM Planner — Uses Cloudflare Workers AI to generate context-aware
 * musical responses based on what peers are currently playing.
 *
 * TAS-113: LLM-Powered Agent
 *
 * The planner:
 * 1. Aggregates the last N measures from all peers
 * 2. Sends context to Workers AI (Llama 3.1)
 * 3. Parses the response into GeneratedNote[]
 * 4. Falls back to pattern generator on error/timeout
 */

import { generateMeasure, type GeneratedNote, type AgentStyle } from '@/shared/music';

// Env type for Workers AI binding
interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<{ response?: string }>;
}

interface MeasureContext {
  key: string;
  bpm: number;
  style: AgentStyle;
  /** Recent notes from all peers in the room — pitch + timing info */
  recentNotes: Array<{ pitch: string; peerId: string; beatTime: number }>;
  /** Current beat position in the room */
  currentBeat: number;
}

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
    // Strip any markdown fences the LLM might add
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
 * Falls back to pattern generator on any failure.
 */
export async function generateMeasureWithAi(
  ai: AiBinding | undefined,
  ctx: MeasureContext,
): Promise<GeneratedNote[]> {
  // If no AI binding available, use pattern generator
  if (!ai) {
    return generateMeasure(ctx.style, ctx.key, ctx.bpm);
  }

  try {
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(ctx) },
      ],
      max_tokens: 512,
      temperature: 0.7,
    });

    if (result.response) {
      const notes = parseAiResponse(result.response);
      if (notes) return notes;
    }

    // AI returned garbage — fallback
    return generateMeasure(ctx.style, ctx.key, ctx.bpm);
  } catch {
    // AI call failed — fallback
    return generateMeasure(ctx.style, ctx.key, ctx.bpm);
  }
}
