import { describe, it, expect } from 'vitest';
import {
  MOTIF_TTL_MS,
  MOTIFS_PER_AGENT,
  motifKey,
  saveMotif,
  motifsFor,
  offeredMotif,
  sweepMotifs,
  armSweep,
  recordSessionMotifs,
  type MotifStorage,
  type MotifRow,
} from './motif-bank';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_790_000_000_000;

/** A bank's whole world: the rows, the alarm, and what was deleted. */
class FakeBank implements MotifStorage {
  readonly rows = new Map<string, unknown>();
  readonly deleted: string[] = [];
  alarm: number | null = null;

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = options?.prefix ?? '';
    for (const [key, value] of this.rows) {
      if (key.startsWith(prefix)) out.set(key, value as T);
    }
    return out;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.rows.set(key, value);
  }

  async delete(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.rows.delete(key)) {
        count++;
        this.deleted.push(key);
      }
    }
    return count;
  }

  async setAlarm(at: number): Promise<void> {
    this.alarm = at;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** One statement, with notes, as the room hands it over. */
const motif = (pitches: string[] = ['C4', 'E4'], slots: number[] = [0, 4]) => ({ pitches, slots });

const row = (over: Partial<MotifRow> = {}): MotifRow => ({
  room: 'room-1',
  agent: 'Jazz Bot',
  session: NOW - 60_000,
  motif: motif(),
  at: NOW - 30_000,
  ...over,
});

/** Put a row in the store WITHOUT the bank's writer, so a test can plant what an alarm should find. */
async function plant(bank: FakeBank, planted: MotifRow): Promise<string> {
  const key = motifKey(planted);
  bank.rows.set(key, planted);
  return key;
}

describe('the motif bank', () => {
  it('writes a statement under the room and the agent, and offers it to a returning agent', async () => {
    const bank = new FakeBank();
    const stored = row();
    await saveMotif(bank, stored, NOW);

    // The key carries the room, the agent and the session; the space in a name is encoded so the
    // agent's prefix cannot collide with a name that begins with another.
    expect(motifKey(stored)).toBe(`motif:room-1:Jazz%20Bot:${stored.session}`);
    expect(bank.rows.has(motifKey(stored))).toBe(true);

    // A returning agent is offered its own newest statement...
    const offered = await offeredMotif(bank, 'room-1', 'Jazz Bot', NOW);
    expect(offered?.motif).toEqual(stored.motif);
    // ...and nobody else's, in this room or another.
    expect(await offeredMotif(bank, 'room-1', 'Funk Bot', NOW)).toBeNull();
    expect(await offeredMotif(bank, 'room-2', 'Jazz Bot', NOW)).toBeNull();
  });

  it(`keeps the last ${MOTIFS_PER_AGENT} statements per agent and forgets the one before them`, async () => {
    const bank = new FakeBank();
    const statements: MotifRow[] = [];
    for (let i = 0; i < MOTIFS_PER_AGENT + 1; i++) {
      // Oldest first, one per session, so the cap has to drop the first one written.
      const at = NOW - (MOTIFS_PER_AGENT - i + 1) * DAY;
      const stored = row({ session: at, at, motif: motif([`C${i + 3}`], [i]) });
      statements.push(stored);
      await saveMotif(bank, stored, NOW);
    }

    const live = await motifsFor(bank, 'room-1', 'Jazz Bot', NOW);
    expect(live).toHaveLength(MOTIFS_PER_AGENT);
    // Newest first, and the oldest of the five is the one that went.
    expect(live[0]?.motif.pitches).toEqual(['C7']);
    expect(bank.rows.has(motifKey(statements[0]!))).toBe(false);
    expect(live.map(r => r.session)).not.toContain(statements[0]!.session);

    // ANOTHER AGENT KEEPS ITS OWN FOUR: the cap is per agent, not per room.
    await saveMotif(bank, row({ agent: 'Funk Bot', session: NOW - DAY, at: NOW - DAY }), NOW);
    expect(await motifsFor(bank, 'room-1', 'Funk Bot', NOW)).toHaveLength(1);
  });

  it('offers nothing once the statement is older than seven days', async () => {
    const bank = new FakeBank();
    // Planted directly: this case is about what the bank OFFERS, not about what its writer prunes.
    await plant(bank, row({ session: NOW - 8 * DAY, at: NOW - MOTIF_TTL_MS - 1 }));

    expect(await motifsFor(bank, 'room-1', 'Jazz Bot', NOW)).toEqual([]);
    expect(await offeredMotif(bank, 'room-1', 'Jazz Bot', NOW)).toBeNull();

    // Exactly at the mark is out, too: the seventh day is the last one that is still live.
    const bang = new FakeBank();
    await plant(bang, row({ at: NOW - MOTIF_TTL_MS }));
    expect(await offeredMotif(bang, 'room-1', 'Jazz Bot', NOW)).toBeNull();
  });

  it('arms the alarm at the earliest expiry, and the sweep deletes only what is older than seven days', async () => {
    const bank = new FakeBank();
    const old = row({ agent: 'Old Bot', session: NOW - 9 * DAY, at: NOW - 8 * DAY });
    const young = row({ agent: 'Young Bot', session: NOW - DAY, at: NOW - DAY });
    const oldKey = await plant(bank, old);
    const youngKey = await plant(bank, young);

    // WHAT THE ALARM IS ARMED FOR BEFORE ANY SWEEP: nothing here has been written by the bank, so
    // arming reads the planted rows — the earliest expiry, not the newest row.
    await armSweep(bank, NOW);
    expect(bank.alarm).toBe(young.at + MOTIF_TTL_MS);

    // THE SWEEP THE ALARM RUNS: the eight-day row goes, the one-day row stays.
    expect(await sweepMotifs(bank, NOW)).toBe(1);
    expect(bank.rows.has(oldKey)).toBe(false);
    expect(bank.rows.has(youngKey)).toBe(true);
    // ...and the alarm is re-armed for the row that is still live, so the next one is not forgotten.
    expect(bank.alarm).toBe(young.at + MOTIF_TTL_MS);
  });

  it('clears the alarm when the sweep leaves nothing to wait for', async () => {
    const bank = new FakeBank();
    await plant(bank, row({ session: NOW - 9 * DAY, at: NOW - 8 * DAY }));

    expect(await sweepMotifs(bank, NOW)).toBe(1);
    expect(bank.rows.size).toBe(0);
    expect(bank.alarm).toBeNull();
  });

  it('writes one row per session per agent, however many times the session is banked', async () => {
    const bank = new FakeBank();
    const session = NOW - 60_000;
    await saveMotif(bank, row({ session, at: NOW - 30_000, motif: motif(['D4'], [2]) }), NOW);
    // The same session banked again — a despawn after the last bar — is an upsert, not a second row.
    await saveMotif(bank, row({ session, at: NOW - 20_000, motif: motif(['E4', 'G4'], [0, 4]) }), NOW);

    const live = await motifsFor(bank, 'room-1', 'Jazz Bot', NOW);
    expect(live).toHaveLength(1);
    expect(live[0]?.motif.pitches).toEqual(['E4', 'G4']);
    expect(bank.rows.size).toBe(1);
  });

  it('banks one statement per agent that played, and nothing for an agent that did not', async () => {
    const bank = new FakeBank();
    const written = await recordSessionMotifs(bank, 'room-1', NOW - 120_000, [
      { agent: 'Jazz Bot', motif: motif(['C4', 'E4'], [0, 4]) },
      { agent: 'Funk Bot', motif: { pitches: [], slots: [] } },
      { agent: 'Ambient Bot', motif: motif(['A3'], [6]) },
    ], NOW);

    expect(written).toBe(2);
    expect(await motifsFor(bank, 'room-1', 'Jazz Bot', NOW)).toHaveLength(1);
    expect(await motifsFor(bank, 'room-1', 'Funk Bot', NOW)).toEqual([]);
    expect(await motifsFor(bank, 'room-1', 'Ambient Bot', NOW)).toHaveLength(1);
    // The statement's own row is stamped with the END of the session, which is its seven-day clock.
    expect((await offeredMotif(bank, 'room-1', 'Jazz Bot', NOW))?.at).toBe(NOW);
  });
});
