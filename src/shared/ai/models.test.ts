import { describe, it, expect } from 'vitest';
import {
  AI_MODELS, FREE_MODEL, SIGNED_MODEL, NO_MODEL,
  isFreeModel, isKnownModel, selectableModels,
} from './models';

/**
 * The retired slugs must never come back: `llama-3.1-8b-instruct` is what this fleet shipped and
 * Cloudflare retired it on 2026-05-30 (error 5028), and the two LoRA models answered prose or ran
 * ten seconds late.
 */
describe('agent models', () => {
  it('lists only models measured answering through this app', () => {
    const ids = AI_MODELS.map(m => m.id);
    expect(ids).not.toContain('@cf/meta/llama-3.1-8b-instruct');
    expect(ids).not.toContain('@cf/google/gemma-7b-it-lora');
    expect(ids).not.toContain('@cf/mistral/mistral-7b-instruct-v0.2-lora');
    expect(ids).toContain(FREE_MODEL);
  });

  it('keeps the public tier to models that fit a measure', () => {
    const free = AI_MODELS.filter(m => m.tier === 'free');
    for (const m of free) expect(m.measuredMs).toBeLessThan(2000);
  });

  it('gates a larger model behind the door', () => {
    const signedOnly = AI_MODELS.find(m => m.tier === 'signed');
    expect(signedOnly).toBeDefined();
    expect(isFreeModel(signedOnly!.id)).toBe(false);
    expect(isFreeModel(FREE_MODEL)).toBe(true);
    expect(selectableModels(false).map(m => m.id)).toEqual([FREE_MODEL]);
    expect(selectableModels(true).length).toBeGreaterThan(1);
  });

  it('knows the pattern agent and rejects an unknown slug', () => {
    expect(isKnownModel(NO_MODEL)).toBe(true);
    expect(isKnownModel('@cf/meta/llama-3.1-8b-instruct')).toBe(false);
    expect(isKnownModel(FREE_MODEL)).toBe(true);
    expect(isKnownModel(SIGNED_MODEL)).toBe(true);
  });
});
