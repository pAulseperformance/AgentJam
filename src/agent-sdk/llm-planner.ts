import type { AgentMusicContext } from './measure-aggregator';
import { formatContextForPrompt } from './measure-aggregator';

/**
 * LLM Note Planner — TAS-99
 *
 * Takes aggregated jam context, constructs a prompt,
 * calls the LLM, and parses output into a NotePlan.
 */

export interface PlannedNote {
  pitch: string;
  beatTime: number;
  velocity: number;
  duration: number;
}

export type NotePlan = PlannedNote[];

export interface LLMPlannerOptions {
  /** LLM API endpoint (e.g., Cloudflare AI, OpenAI) */
  apiUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Model identifier */
  model?: string;
  /** Maximum response time in ms (default: 200) */
  timeoutMs?: number;
}

/** Valid pitch pattern: letter + optional accidental + octave */
const PITCH_PATTERN = /^[A-G][#b]?\d$/;

/** Quantize to 16th-note grid */
function quantizeBeatTime(beatTime: number): number {
  return Math.round(beatTime * 4) / 4;
}

/**
 * Validate and sanitize a single note from LLM output.
 * Returns null if invalid.
 */
function validateNote(raw: unknown): PlannedNote | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  const pitch = typeof obj['pitch'] === 'string' ? obj['pitch'] : null;
  const beatTime = typeof obj['beatTime'] === 'number' ? obj['beatTime'] : null;
  const velocity = typeof obj['velocity'] === 'number' ? obj['velocity'] : null;
  const duration = typeof obj['duration'] === 'number' ? obj['duration'] : null;

  if (!pitch || beatTime === null || velocity === null || duration === null) return null;
  if (!PITCH_PATTERN.test(pitch)) return null;
  if (beatTime < 0 || beatTime >= 4) return null;
  if (velocity < 0 || velocity > 1) return null;
  if (duration <= 0 || duration > 4) return null;

  return {
    pitch,
    beatTime: quantizeBeatTime(beatTime),
    velocity: Math.max(0.1, Math.min(1.0, velocity)),
    duration: Math.max(0.0625, Math.min(4.0, duration)),
  };
}

/**
 * Parse LLM response text into a validated NotePlan.
 * Handles JSON extraction from mixed text/code blocks.
 */
function parseLLMResponse(text: string): NotePlan {
  // Try to extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    const notes = parsed
      .map(validateNote)
      .filter((n): n is PlannedNote => n !== null)
      .slice(0, 16); // Hard cap: 16 notes per measure

    return notes;
  } catch {
    return [];
  }
}

export class LLMNotePlanner {
  private options: LLMPlannerOptions;

  constructor(options: LLMPlannerOptions) {
    this.options = options;
  }

  /**
   * Generate a note plan from the current music context.
   * Returns empty plan on timeout or error (safe fallback = silence).
   */
  async generatePlan(context: AgentMusicContext): Promise<NotePlan> {
    const prompt = formatContextForPrompt(context);
    const timeoutMs = this.options.timeoutMs ?? 200;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(this.options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.apiKey ? { 'Authorization': `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.options.model ?? '@cf/meta/llama-3.1-8b-instruct',
          messages: [
            { role: 'system', content: 'You are a jazz musician AI. Reply ONLY with a JSON array of notes.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 512,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[LLMPlanner] API returned ${response.status}`);
        return [];
      }

      const data = await response.json() as Record<string, unknown>;

      // Handle different API response shapes
      let text = '';
      if (typeof data['response'] === 'string') {
        text = data['response'];
      } else if (Array.isArray(data['choices'])) {
        const choice = data['choices'][0] as Record<string, unknown> | undefined;
        if (choice && typeof choice['message'] === 'object') {
          const msg = choice['message'] as Record<string, unknown>;
          text = typeof msg['content'] === 'string' ? msg['content'] : '';
        }
      } else if (typeof data['result'] === 'object' && data['result'] !== null) {
        const result = data['result'] as Record<string, unknown>;
        text = typeof result['response'] === 'string' ? result['response'] : '';
      }

      return parseLLMResponse(text);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn(`[LLMPlanner] Timeout after ${timeoutMs}ms — returning silent rest`);
      } else {
        console.warn('[LLMPlanner] Generation failed:', err);
      }
      return []; // Silence is a valid musical response
    }
  }
}
