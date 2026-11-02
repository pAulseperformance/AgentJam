import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from './types';
import { STYLE_IDS } from '@/shared/music/styles';

/**
 * THE WIRE LIST IS THE REGISTRY'S, not a second copy of it. When the enum was retyped by hand, a row
 * added to the table could be missing from the protocol and the room would refuse a style its own
 * panel offered. Two directions are checked: every row is accepted, and a name that is not a row is
 * refused rather than quietly coerced.
 */
describe('the spawn_agent style enum', () => {
  it('accepts every style the registry lists', () => {
    for (const id of STYLE_IDS) {
      const parsed = ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'Bit', style: id });
      expect(parsed.success, `the registry lists ${id}`).toBe(true);
    }
  });

  it('refuses a style that is not a row, and accepts no style at all', () => {
    expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'Bit', style: 'polka' }).success).toBe(false);
    // ABSENT IS NOT INVALID: a bot spawned with no style is born into the room's vibe, which is the
    // whole point of the vibe field. What must never happen is a style the registry cannot name.
    expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'Bit' }).success).toBe(true);
  });
});
