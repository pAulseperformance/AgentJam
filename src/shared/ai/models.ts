/**
 * The agent models, in one place, because two sides must agree on them: the room enforces which tier
 * may select which model, and the panel offers them. A second copy in the client is how a retired
 * slug survives a fix (the deprecated `@cf/meta/llama-3.1-8b-instruct` was listed twice).
 *
 * MEASURED, not guessed: every entry below answered THROUGH THIS APP on 2026-10-29 with a valid note
 * array (remote Workers AI binding). The models that were dropped are dropped for a measured reason:
 *   - `@cf/meta/llama-3.1-8b-instruct` -> retired upstream (error 5028, 2026-05-30)
 *   - `@cf/google/gemma-7b-it-lora`   -> answered prose, never JSON (6.2s)
 *   - `@cf/mistral/mistral-7b-instruct-v0.2-lora` -> answered JSON at 10.4s, five measures late
 */

export type ModelTier = 'free' | 'signed';

export interface AgentModel {
  id: string;
  label: string;
  /** who may select it: `free` is the anonymous budget, `signed` needs the zpe door */
  tier: ModelTier;
  /** one measure at 120 BPM is 2000ms; a larger number means the call can miss its own bar */
  measuredMs: number;
}

export const AI_MODELS: readonly AgentModel[] = [
  { id: '@cf/meta/llama-3.2-3b-instruct', label: 'Llama 3.2 3B', tier: 'free', measuredMs: 557 },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tier: 'signed', measuredMs: 3853 },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', tier: 'signed', measuredMs: 5483 },
] as const;

/** The anonymous budget: the smallest model that still lands inside a measure. */
export const FREE_MODEL = '@cf/meta/llama-3.2-3b-instruct';

/** A signed-in room's default: Jev supplies the judgement, so a slower renderer buys nothing. */
export const SIGNED_MODEL = '@cf/meta/llama-3.2-3b-instruct';

/** 'none' is the deterministic pattern agent, which is a choice and not a model. */
export const NO_MODEL = 'none';

export function modelFor(id: string): AgentModel | undefined {
  return AI_MODELS.find(m => m.id === id);
}

export function isFreeModel(id: string): boolean {
  return modelFor(id)?.tier === 'free';
}

export function isKnownModel(id: string): boolean {
  return id === NO_MODEL || Boolean(modelFor(id));
}

/** What a given viewer may pick, in display order. */
export function selectableModels(signedIn: boolean): AgentModel[] {
  return AI_MODELS.filter(m => signedIn || m.tier === 'free');
}
