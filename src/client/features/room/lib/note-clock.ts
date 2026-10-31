/**
 * Where a remote note belongs in time, from the slot the server stamped on it.
 *
 * The server addresses every note to `transportStart + bar*barMs + beat*beatMs` and ships that slot as a
 * delay from the moment the message leaves. The client used to ignore it and play on arrival plus a fixed
 * 40 ms, so socket jitter and a busy main thread landed in the audio: measured against the drummer's kick
 * in the 2026-10-31T15-44-31 session (125 BPM, 721 notes), 73% of notes sat within 40 ms of their slot and
 * the rest were 100 to 300 ms out, with the first pair of a phrase squashed together.
 *
 * A slot that has already gone is DROPPED rather than shoved in at "now". A dropped note is a bar with a
 * hole in it; a shoved note is a bar played off the grid, which is the thing that sounds broken.
 */

/** How late a slot may be before its note is dropped instead of played. */
export const STALE_SLOT_MS = 120;

/**
 * The delay to play a note at, in ms, or null when its slot is too far behind to sound on the beat.
 * An event with no slot (an older server, a local key press) gets 0 and plays now.
 */
export function slotDelayMs(inMs: number | null | undefined, staleMs = STALE_SLOT_MS): number | null {
  if (typeof inMs !== 'number' || !Number.isFinite(inMs)) return 0;
  if (inMs < -staleMs) return null;
  return Math.max(0, Math.round(inMs));
}
