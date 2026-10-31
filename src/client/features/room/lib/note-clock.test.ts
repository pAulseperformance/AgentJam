import { describe, it, expect } from 'vitest';
import { slotDelayMs, STALE_SLOT_MS } from './note-clock';

describe('slotDelayMs', () => {
  it('waits for a slot that is still ahead', () => {
    expect(slotDelayMs(400)).toBe(400);
    expect(slotDelayMs(1)).toBe(1);
  });

  it('plays a slot that has only just passed, so a small jitter never loses a note', () => {
    expect(slotDelayMs(-40)).toBe(0);
    expect(slotDelayMs(-STALE_SLOT_MS + 1)).toBe(0);
  });

  it('drops a slot that is too far behind to sound on its beat', () => {
    expect(slotDelayMs(-STALE_SLOT_MS - 1)).toBeNull();
    expect(slotDelayMs(-300)).toBeNull();
  });

  it('plays now when the event carries no slot at all', () => {
    expect(slotDelayMs(undefined)).toBe(0);
    expect(slotDelayMs(null)).toBe(0);
    expect(slotDelayMs(Number.NaN)).toBe(0);
  });

  it('rounds to whole milliseconds, because the engine takes milliseconds', () => {
    expect(slotDelayMs(333.6)).toBe(334);
  });
});
