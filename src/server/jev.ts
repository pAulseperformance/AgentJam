/**
 * JEV, the decision layer for a signed-in room.
 *
 * Jev (TypeSafe System One) is a TYPED DECISION model: send state plus typed questions, get back
 * `noul` (a 0-1 probability), `choice` (from a fixed set) or `score`, with confidence. It generates
 * no text and no notes, so it cannot replace the renderer, it decides WHAT the renderer should play,
 * which is exactly the judgement the code cannot compute for itself.
 *
 * Contract (verified 2026-10-29 against OpenRouter's alpha decisions surface: HTTP 200, the endpoint
 * resolved `typesafe/jev-1.13-20260917`, 417 input tokens, $0.0000175 per call):
 *   POST {endpoint}  {state, model, questions: {id: {type, instructions, criteria}}}
 *   -> {answers: {id: {choice|noul, confidence?, probabilities?}}}
 *
 * Rules carried from the fleet's Jev skill:
 *   - ONE call per measure, the whole battery inside it (every extra call pays the state payload again).
 *   - `noul >= 0.5` is the gate; confidence is quoted, never gated on, until the state is canonical.
 *   - FAIL-OPEN for music: a missing or slow decision must never silence the agent. It returns null and
 *     the renderer plays without a brief.
 *   - The model slug differs per gateway (`jev-latest` direct, `typesafe/jev-1.13` on a router).
 */

import type { DecisionBrief } from './llm-planner';

export type { AgentRole, MotifRelation, DecisionBrief } from './llm-planner';

export interface JevConfig {
  /** e.g. https://openrouter.ai/api/alpha/decisions or https://api.typesafe.ai/v1/systemone */
  endpoint: string;
  /** `jev-latest` on TypeSafe direct, `typesafe/jev-1.13` on a router */
  model: string;
  apiKey: string;
  /** a decision that misses the measure is worthless; fail open well before the beat arrives */
  timeoutMs?: number;
}

export interface JevState {
  key: string;
  bpm: number;
  style: string;
  /** how the room sounds right now, as the listener summarized it */
  phrase: string;
  /** the agent's own last statement, so it can develop instead of restart */
  motif: string;
  /** how many of the last bars it played: a partner that has played four straight should lay out */
  activity: string;
  peers: number;
}

const DEFAULT_TIMEOUT_MS = 1200;

/**
 * The questions. Three judgements the renderer cannot make for itself, all judged against one state:
 * how much to play, where, and whether to play at all.
 */
export const JEV_QUESTIONS = {
  role: {
    type: 'choice',
    instructions: 'What should this agent do with the next bar in a live jam with another player? Answering what they just played is often better than leading, and silence is a legitimate move.',
    criteria: {
      lead: 'state your own line, they are not playing much',
      answer: 'respond to the phrase they just played',
      ornament: 'decorate or support what they are doing without taking the lead',
      rest: 'sit this bar out and let them carry it: only worth it if you have already played most of the last few bars',
    },
  },
  relation: {
    type: 'choice',
    instructions: 'How should this bar relate to the line this agent itself played last bar?',
    criteria: {
      restate: 'keep the same idea, repeat or nearly repeat it',
      vary: 'develop it: change the register or the rhythm but keep two of the same pitches',
      new: 'drop the old idea and start a new one',
    },
  },
  density: {
    type: 'choice',
    instructions: 'Choose how many notes this agent should play in the next measure so that it complements the other players. Leaving space matters more than filling the bar.',
    criteria: {
      sparse: '2 to 4 notes, leaving most of the measure silent',
      medium: '5 to 8 notes, a steady presence',
      dense: '9 to 12 notes, filling the measure',
    },
  },
  register: {
    type: 'choice',
    instructions: 'Choose the register this agent should play in so it does not collide with the notes the other players are already using.',
    criteria: {
      low: 'below C4, bass and low mids',
      mid: 'between C4 and C5',
      high: 'C5 and above, upper register',
    },
  },
  veto: {
    type: 'noul',
    instructions: 'Is the room already crowded enough that this agent should rest for this measure instead of adding notes?',
    criteria: {
      true: 'the room is crowded, rest',
      false: 'there is space, play',
    },
  },
} as const;

export function buildJevState(s: JevState): string {
  return [
    `A collaborative jam room. ${s.peers} player(s) connected.`,
    `Tempo ${s.bpm} BPM, key ${s.key}, this agent plays ${s.style}.`,
    `What the others are playing: ${s.phrase}.`,
    `This agent's own last statement (its motif): ${s.motif}.`,
    `This agent's recent activity: ${s.activity}.`,
  ].join('\n');
}

interface JevAnswer {
  choice?: string;
  noul?: number;
  confidence?: number;
}

interface JevResponse {
  answers?: Record<string, JevAnswer | undefined>;
}

/** One call, one battery. Returns null when the decision does not arrive in time or is unusable. */
export async function decideWithJev(
  cfg: JevConfig | null,
  state: JevState,
): Promise<DecisionBrief | null> {
  if (!cfg?.endpoint || !cfg.apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        state: buildJevState(state),
        model: cfg.model,
        questions: JEV_QUESTIONS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const body = (await res.json()) as JevResponse;
    const answers = body?.answers;
    if (!answers) return null;

    const density = answers.density?.choice;
    const register = answers.register?.choice;
    const role = answers.role?.choice ?? 'lead';
    const relation = answers.relation?.choice ?? 'new';
    if (!density || !register) return null;
    if (!isRole(role) || !isRelation(relation) || !isDensity(density) || !isRegister(register)) return null;

    // Router passthroughs differ: OrcaRouter omits confidence on a noul answer, so read only `noul`.
    const veto = answers.veto?.noul;
    const play = role !== 'rest' && (typeof veto === 'number' ? veto < 0.5 : true);

    return { role, relation, density, register, play, latencyMs: Date.now() - startedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRole(v: string): v is DecisionBrief['role'] {
  return v === 'lead' || v === 'answer' || v === 'ornament' || v === 'rest';
}

function isRelation(v: string): v is DecisionBrief['relation'] {
  return v === 'restate' || v === 'vary' || v === 'new';
}

function isDensity(v: string): v is DecisionBrief['density'] {
  return v === 'sparse' || v === 'medium' || v === 'dense';
}

function isRegister(v: string): v is DecisionBrief['register'] {
  return v === 'low' || v === 'mid' || v === 'high';
}

/** Read the config out of the Worker env, or null when the signed-in layer is not provisioned. */
export function jevConfigFromEnv(env: {
  JEV_ENDPOINT?: string;
  JEV_MODEL?: string;
  JEV_API_KEY?: string;
}): JevConfig | null {
  if (!env.JEV_API_KEY) return null;
  return {
    endpoint: env.JEV_ENDPOINT || 'https://openrouter.ai/api/alpha/decisions',
    model: env.JEV_MODEL || 'typesafe/jev-1.13',
    apiKey: env.JEV_API_KEY,
  };
}
