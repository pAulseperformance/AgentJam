import { describe, expect, it } from 'vitest';
import { systemPrompt } from './llm-planner';
import { STYLE_ROWS } from '@/shared/music/styles';

/**
 * THE PROMPT CARRIES THE ROW. The system prompt used to describe three genres in one parenthetical, so
 * a fourth style would have reached the model as a bare id it had never been told about: the room would
 * have played a label, not a style.
 */
describe('the system prompt', () => {
  it('gives every style its own words', () => {
    for (const row of STYLE_ROWS) {
      const prompt = systemPrompt(row.id);
      expect(prompt, `${row.id} carries its verbs`).toContain(row.verbs);
      const others = STYLE_ROWS.filter(other => other.id !== row.id && other.verbs !== row.verbs);
      for (const other of others) {
        expect(prompt.includes(other.verbs), `${row.id} does not describe ${other.id}`).toBe(false);
      }
    }
  });

  it('no longer recites the three-genre glossary', () => {
    const prompt = systemPrompt('jazz');
    expect(prompt.includes('swing + 7th chords, ambient = long drones')).toBe(false);
    expect(prompt).toContain('Generate 4-12 notes per measure');
  });
});
