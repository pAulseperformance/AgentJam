/**
 * SESSION RECORDER.
 *
 * A person listening to the room is the only instrument that can judge whether it sounds good, and an
 * argument about it in chat is useless without what actually played. So the room keeps a log of every
 * message it received, and one button hands the whole session over as JSON: the notes, their velocities
 * and beats, and the agent's own debug line for every bar.
 *
 * Kept in the client, not the Worker: the DO already persists items, but what a listener needs to send
 * is the sequence AS HE HEARD IT, including the bars that arrived late or not at all.
 */

export interface RecordedMessage {
  /** ms since the session started recording */
  t: number;
  type: string;
  data: Record<string, unknown>;
}

export interface SessionMeta {
  room: string | null;
  bpm: number | null;
  key: string | null;
  transportStartTime: number | null;
  startedAt: number;
  recordedFrom: number;
}

const MAX_MESSAGES = 5000;

let meta: SessionMeta = {
  room: null,
  bpm: null,
  key: null,
  transportStartTime: null,
  startedAt: Date.now(),
  recordedFrom: Date.now(),
};

let messages: RecordedMessage[] = [];

/**
 * Start a session ONCE per room. `room_state` is broadcast again on every tempo and key change, so
 * calling this from that handler emptied the whole log mid-session.
 */
export function beginSession(room: string): boolean {
  if (meta.room === room && messages.length > 0) return false;
  meta = { ...meta, room, startedAt: Date.now(), recordedFrom: Date.now() };
  messages = [];
  return true;
}

export function noteRoomState(roomState: { bpm: number; key: string; transportStartTime: number }): void {
  meta = { ...meta, bpm: roomState.bpm, key: roomState.key, transportStartTime: roomState.transportStartTime };
}

export function recordMessage(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  // JSON.parse('null') is null, and null.type throws. A malformed payload must cost one log line,
  // not the room's message handler: this runs inside ws.onmessage, outside any try.
  if (!parsed || typeof parsed !== 'object') return;
  const data = parsed as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : 'unknown';
  // the message types worth keeping: what played, and what the agent decided for each bar
  if (!/note_o|ai_debug|agent_spawned|peer_|bpm_change|key_change|error/.test(type)) return;

  messages.push({ t: Date.now() - meta.recordedFrom, type, data });
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
}

export function recordedCount(): number {
  return messages.length;
}

export interface SessionFile {
  room: string | null;
  bpm: number | null;
  key: string | null;
  transportStartTime: number | null;
  recordedMs: number;
  noteCount: number;
  notes: Array<{ t: number; peerId: string; pitch: string; velocity: number; beatTime: number; kind: 'on' | 'off' }>;
  bars: Array<Record<string, unknown>>;
  messages: RecordedMessage[];
}

/** The whole session, with the notes lifted out so a reader does not have to parse the log. */
export function sessionSnapshot(): SessionFile {
  const notes: SessionFile['notes'] = [];
  const bars: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.type === 'note_on' || m.type === 'note_off') {
      notes.push({
        t: m.t,
        peerId: String(m.data.peerId ?? ''),
        pitch: String(m.data.pitch ?? ''),
        velocity: Number(m.data.velocity ?? 0),
        beatTime: Number(m.data.beatTime ?? 0),
        kind: m.type === 'note_on' ? 'on' : 'off',
      });
    }
    if (m.type === 'ai_debug') {
      const agentMeta = (m.data.meta ?? {}) as Record<string, unknown>;
      const brief = (agentMeta.brief ?? {}) as Record<string, unknown>;
      // THIS IS A WHITELIST, and a field left out of it never reaches a reader: the row below is built
      // key by key, so `stride` (Task 13's badge) arrives as `undefined` unless it is named here, and a
      // test that only asserts "a badge exists" still passes on it. Name every field a panel reads.
      bars.push({
        t: m.t,
        agent: m.data.agentName ?? null,
        source: agentMeta.source ?? null,
        model: agentMeta.model ?? null,
        latencyMs: agentMeta.latencyMs ?? null,
        noteCount: agentMeta.noteCount ?? null,
        plan: agentMeta.plan ?? null,
        refreshed: agentMeta.refreshed ?? false,
        completed: agentMeta.completed ?? 0,
        role: brief.role ?? null,
        density: brief.density ?? null,
        register: brief.register ?? null,
        relation: brief.relation ?? null,
        stride: agentMeta.stride ?? null,
        error: agentMeta.error ?? null,
      });
    }
  }

  return {
    room: meta.room,
    bpm: meta.bpm,
    key: meta.key,
    transportStartTime: meta.transportStartTime,
    recordedMs: meta.recordedFrom ? Date.now() - meta.recordedFrom : 0,
    noteCount: notes.length,
    notes,
    bars,
    messages,
  };
}

/** Hand the session to the browser as a file. One button, one file, no clipboard. */
export function downloadSession(): number {
  const snapshot = sessionSnapshot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jam-session-${meta.room ?? 'room'}-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // the blob is only needed until the browser has started the download
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return snapshot.noteCount;
}
