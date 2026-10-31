/**
 * WHAT THE ROOM REMEMBERS BETWEEN SESSIONS.
 *
 * A jam room is the same room tomorrow as it was tonight: the same id, the same band, the same people
 * coming back. Before this file every session started as a stranger — the agent's first bar was
 * "none yet (this would be your first statement)" whether it had played forty bars in this room
 * yesterday or never at all.
 *
 * So a finished session leaves one row per agent: the last phrase that agent actually played (the
 * pitches and the sixteenth slots), stamped with the session it came from. A returning agent is
 * offered its own newest live row on the first bar of the next session. The last FOUR statements per
 * agent are kept, and a row lives seven days: an alarm on the Durable Object deletes what is older,
 * whether or not anybody is in the room.
 *
 * The rows live in the object's OWN storage, under `motif:<room>:<agent>:<session>`. That is the
 * decision the plan records: a shared room is shared memory, and localStorage on one browser is not.
 *
 * Only the slice of DurableObjectStorage the bank uses is named here, so the bank is exercised with a
 * fake store in its own test and with the real object in jam-room.test.ts.
 */
import type { Motif } from './listener';

/** SEVEN DAYS. Older than this is not a memory, it is a stranger. */
export const MOTIF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** HOW MANY STATEMENTS ONE AGENT GETS TO KEEP, across sessions. */
export const MOTIFS_PER_AGENT = 4;

/** Every bank row starts with this, so one list call reads the whole bank. */
export const MOTIF_PREFIX = 'motif:';

export interface MotifRow {
  /** the room id this row belongs to (the object that stores it is keyed by the same id) */
  room: string;
  /** the agent's name, which is the only identity that survives a session */
  agent: string;
  /** when the session that heard this statement opened, in ms; one row per agent per session */
  session: number;
  /** the phrase itself: pitches and sixteenth slots */
  motif: Motif;
  /** when the session ended, in ms — the row's clock for the seven days */
  at: number;
}

/** The storage the bank needs. DurableObjectStorage is one; a plain fake is another. */
export type MotifStorage = Pick<DurableObjectStorage, 'list' | 'put' | 'setAlarm' | 'deleteAlarm'> & {
  delete(keys: string[]): Promise<number>;
};

/** One agent's statement, as a finished session hands it over. */
export interface SessionStatement {
  agent: string;
  motif: Motif;
}

const enc = (part: string): string => encodeURIComponent(part);

/** The key a row is written under. Session in the key, so re-banking one session is one row. */
export function motifKey(row: Pick<MotifRow, 'room' | 'agent' | 'session'>): string {
  return `${MOTIF_PREFIX}${enc(row.room)}:${enc(row.agent)}:${row.session}`;
}

/** The prefix one agent's rows share, so the cap of four never lists another agent's. */
function agentPrefix(room: string, agent: string): string {
  return `${MOTIF_PREFIX}${enc(room)}:${enc(agent)}:`;
}

/** A stored value is a row only if every field a reader uses is there. */
function isRow(value: unknown): value is MotifRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<MotifRow>;
  return typeof row.room === 'string'
    && typeof row.agent === 'string'
    && typeof row.session === 'number'
    && typeof row.at === 'number'
    && !!row.motif
    && Array.isArray(row.motif.pitches)
    && Array.isArray(row.motif.slots);
}

/** Is this row still inside the seven days? A row exactly at the mark is out. */
function live(row: MotifRow, now: number): boolean {
  return now - row.at < MOTIF_TTL_MS;
}

/** Newest first: the most recent session wins, and a tie is broken deterministically. */
function newestFirst(a: { key: string; row: MotifRow }, b: { key: string; row: MotifRow }): number {
  if (a.row.at !== b.row.at) return b.row.at - a.row.at;
  if (a.row.session !== b.row.session) return b.row.session - a.row.session;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

async function rowsUnder(storage: MotifStorage, prefix: string): Promise<Array<{ key: string; row: MotifRow }>> {
  const listed = await storage.list<MotifRow>({ prefix });
  const rows: Array<{ key: string; row: MotifRow }> = [];
  for (const [key, value] of listed) {
    if (isRow(value)) rows.push({ key, row: value });
  }
  return rows;
}

/** THE BANK, ALL OF IT. One room's object holds only this room's rows. */
function allRows(storage: MotifStorage): Promise<Array<{ key: string; row: MotifRow }>> {
  return rowsUnder(storage, MOTIF_PREFIX);
}

/** ONE AGENT'S ROWS. */
function agentRows(storage: MotifStorage, room: string, agent: string): Promise<Array<{ key: string; row: MotifRow }>> {
  return rowsUnder(storage, agentPrefix(room, agent));
}

/**
 * ARM THE SWEEP AT THE EARLIEST EXPIRY IN THE BANK.
 *
 * The alarm is the only part of the bank that runs when nobody is in the room, so it is armed to the
 * first row that goes out of date and re-armed after every sweep. An empty (or all-expired) bank
 * clears it: an alarm with nothing to do would wake the object for nothing.
 */
export async function armSweep(storage: MotifStorage, now = Date.now()): Promise<void> {
  let next = Infinity;
  for (const { row } of await allRows(storage)) {
    const expires = row.at + MOTIF_TTL_MS;
    if (expires > now && expires < next) next = expires;
  }
  if (next === Infinity) await storage.deleteAlarm();
  else await storage.setAlarm(next);
}

/**
 * DELETE EVERY ROW OLDER THAN SEVEN DAYS, then arm the alarm for the next one due.
 * Returns how many rows went, which is what the sweep's test counts.
 */
export async function sweepMotifs(storage: MotifStorage, now = Date.now()): Promise<number> {
  const expired = (await allRows(storage))
    .filter(({ row }) => !live(row, now))
    .map(({ key }) => key);
  if (expired.length > 0) await storage.delete(expired);
  await armSweep(storage, now);
  return expired.length;
}

/**
 * WRITE ONE STATEMENT AND KEEP THE AGENT'S LAST FOUR.
 *
 * The row's key carries the session, so writing the same agent twice in one session is an upsert and
 * never a duplicate. Statements past the fourth (and anything out of date) are deleted here rather
 * than waiting for the alarm: the cap is a property of the bank, not of the sweep.
 */
export async function saveMotif(storage: MotifStorage, row: MotifRow, now = Date.now()): Promise<void> {
  await storage.put(motifKey(row), row);
  const mine = await agentRows(storage, row.room, row.agent);
  const keep = mine.filter(({ row: r }) => live(r, now)).sort(newestFirst).slice(0, MOTIFS_PER_AGENT);
  const keepKeys = new Set(keep.map(({ key }) => key));
  const drop = mine.filter(({ key }) => !keepKeys.has(key)).map(({ key }) => key);
  if (drop.length > 0) await storage.delete(drop);
  // The sweep that follows also arms the alarm for the WHOLE bank, which the per-agent trim cannot:
  // another agent's oldest row may be the next one due.
  await sweepMotifs(storage, now);
}

/** THIS AGENT'S LIVE STATEMENTS, newest first, at most four. */
export async function motifsFor(
  storage: MotifStorage,
  room: string,
  agent: string,
  now = Date.now(),
): Promise<MotifRow[]> {
  const mine = await agentRows(storage, room, agent);
  return mine
    .filter(({ row }) => live(row, now))
    .sort(newestFirst)
    .slice(0, MOTIFS_PER_AGENT)
    .map(({ row }) => row);
}

/** WHAT TO OFFER A RETURNING AGENT: its newest statement that is still inside the seven days. */
export async function offeredMotif(
  storage: MotifStorage,
  room: string,
  agent: string,
  now = Date.now(),
): Promise<MotifRow | null> {
  const rows = await motifsFor(storage, room, agent, now);
  return rows[0] ?? null;
}

/**
 * ONE ROW PER AGENT FOR A FINISHED SESSION.
 *
 * A session that heard no statement from an agent writes nothing for it: an empty motif would be the
 * bank remembering silence, and the next session would be offered a phrase nobody played.
 */
export async function recordSessionMotifs(
  storage: MotifStorage,
  room: string,
  session: number,
  statements: readonly SessionStatement[],
  at = Date.now(),
): Promise<number> {
  let written = 0;
  for (const statement of statements) {
    if (statement.motif.pitches.length === 0) continue;
    await saveMotif(storage, { room, agent: statement.agent, session, motif: statement.motif, at }, at);
    written++;
  }
  return written;
}
