import {
  DEFAULT_BPM,
  DEFAULT_KEY,
  PEER_COLORS,
  NOTE_EVENT_TYPE_MARKER,
  FLUSH_INTERVAL_MS,
  MAX_NOTES_PER_SECOND,
  WS_CLOSE_NORMAL,
} from '@/shared/protocol/constants';
import {
  ClientMessageSchema,
  type Peer,
  type RoomState,
  type NoteEvent,
} from '@/shared/protocol/types';

interface PeerConnection {
  peer: Peer;
  ws: WebSocket;
  activeNotes: Set<string>; // pitches currently held — for MIDI panic
  noteCount: number; // rate limiter — notes in current window
  lastNoteWindow: number; // timestamp of current rate-limit window start
}

/**
 * JamRoom Durable Object — the central hub for a jam session.
 *
 * Responsibilities:
 * - WebSocket lifecycle (connect, message, close, error)
 * - Room state management (BPM, key, transport)
 * - Peer tracking with color assignment
 * - Hot-path note relay (string-match, no JSON.parse)
 * - Active note tracking for MIDI panic on disconnect
 * - Batch SQLite persistence for note events
 */
export class JamRoom implements DurableObject {
  private peers: Map<WebSocket, PeerConnection> = new Map();
  private roomState: RoomState;
  private colorIndex = 0;
  private pendingFlush: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    _env: unknown,
  ) {
    this.roomState = {
      bpm: DEFAULT_BPM,
      key: DEFAULT_KEY,
      transportStartTime: Date.now(),
      serverTime: Date.now(),
    };

    // Restore persisted room state if available
    void this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RoomState>('roomState');
      if (stored) {
        this.roomState = stored;
      }
    });

    // Accept WebSocket hibernation callbacks
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    // Health check
    if (url.pathname.endsWith('/health')) {
      return Response.json({
        peers: this.peers.size,
        bpm: this.roomState.bpm,
        key: this.roomState.key,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ─── Hibernation API Callbacks ──────────────────────────────────────────────

  webSocketOpen(ws: WebSocket): void {
    // Peer is not yet registered — they must send a join_room message first.
    // We do NOT add to this.peers until join_room is received.
    void ws; // connection registered, awaiting join
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;

    // ── Hot Path: Note event relay (no JSON.parse) ──
    if (message.includes(NOTE_EVENT_TYPE_MARKER)) {
      this.handleNoteHotPath(ws, message);
      return;
    }

    // ── Cold Path: Parse and validate all other messages ──
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendError(ws, 'Invalid JSON');
      return;
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.sendError(ws, `Invalid message: ${result.error.issues[0]?.message ?? 'unknown'}`);
      return;
    }

    const msg = result.data;

    switch (msg.type) {
      case 'join_room':
        this.handleJoin(ws, msg.name, msg.kind, msg.instrument);
        break;
      case 'bpm_change':
        this.handleBpmChange(ws, msg.bpm);
        break;
      case 'key_change':
        this.handleKeyChange(ws, msg.key);
        break;
      case 'clock_sync_ping':
        this.handleClockSyncPing(ws, msg.t0);
        break;
      case 'note_on':
      case 'note_off':
        // Fallback for note events that didn't match hot-path string
        this.handleNoteColdPath(ws, msg);
        break;
    }
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    this.handleDisconnect(ws, code);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.handleDisconnect(ws, WS_CLOSE_NORMAL);
  }

  // ─── Message Handlers ───────────────────────────────────────────────────────

  private handleJoin(ws: WebSocket, name: string, kind: 'human' | 'agent', instrument?: string): void {
    const color = PEER_COLORS[this.colorIndex % PEER_COLORS.length] ?? '#6366f1';
    this.colorIndex++;

    const peer: Peer = {
      peerId: crypto.randomUUID(),
      name,
      kind,
      instrument: instrument ?? 'PolySynth',
      color,
    };

    this.peers.set(ws, {
      peer,
      ws,
      activeNotes: new Set(),
      noteCount: 0,
      lastNoteWindow: Date.now(),
    });

    // Start flush interval on first peer
    if (this.peers.size === 1 && !this.flushInterval) {
      this.flushInterval = setInterval(() => this.flushToSQLite(), FLUSH_INTERVAL_MS);
    }

    // Send room state + full peer list to the new peer
    this.roomState.serverTime = Date.now();
    const peers = Array.from(this.peers.values()).map((c) => c.peer);

    this.send(ws, {
      type: 'room_state',
      roomState: this.roomState,
      peers,
    });

    // Broadcast new peer to everyone else
    this.broadcast(ws, { type: 'peer_joined', peer });
  }

  private handleDisconnect(ws: WebSocket, _code: number): void {
    const conn = this.peers.get(ws);
    if (!conn) return;

    // ── MIDI Panic: broadcast note_off for all active notes ──
    if (conn.activeNotes.size > 0) {
      const now = Date.now();
      for (const pitch of conn.activeNotes) {
        const noteOff: NoteEvent = {
          type: 'note_off',
          peerId: conn.peer.peerId,
          pitch,
          beatTime: 0, // immediate
          velocity: 0,
          timestamp: now,
        };
        this.broadcastAll(JSON.stringify(noteOff));
      }
    }

    this.peers.delete(ws);

    // Broadcast peer_left to remaining peers
    this.broadcastAll(JSON.stringify({
      type: 'peer_left',
      peerId: conn.peer.peerId,
    }));

    // Clean up flush interval if room is empty
    if (this.peers.size === 0 && this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
      void this.flushToSQLite(); // final flush
    }

    try { ws.close(); } catch { /* already closed */ }
  }

  private handleNoteHotPath(ws: WebSocket, rawMessage: string): void {
    const conn = this.peers.get(ws);
    if (!conn) return;

    // Rate limit check
    const now = Date.now();
    if (now - conn.lastNoteWindow > 1000) {
      conn.noteCount = 0;
      conn.lastNoteWindow = now;
    }
    conn.noteCount++;
    if (conn.noteCount > MAX_NOTES_PER_SECOND) return; // silently drop

    // Track active notes for MIDI panic
    if (rawMessage.includes('"note_on"')) {
      const pitchMatch = rawMessage.match(/"pitch":"([^"]+)"/);
      if (pitchMatch?.[1]) conn.activeNotes.add(pitchMatch[1]);
    } else if (rawMessage.includes('"note_off"')) {
      const pitchMatch = rawMessage.match(/"pitch":"([^"]+)"/);
      if (pitchMatch?.[1]) conn.activeNotes.delete(pitchMatch[1]);
    }

    // Relay raw string to all OTHER peers — zero JSON.parse overhead
    this.broadcast(ws, rawMessage);

    // Queue for batch persistence
    this.pendingFlush.push(rawMessage);
  }

  private handleNoteColdPath(ws: WebSocket, msg: NoteEvent): void {
    // Fallback path — note events that didn't match the hot-path string marker
    const conn = this.peers.get(ws);
    if (!conn) return;

    if (msg.type === 'note_on') {
      conn.activeNotes.add(msg.pitch);
    } else {
      conn.activeNotes.delete(msg.pitch);
    }

    const serialized = JSON.stringify(msg);
    this.broadcast(ws, serialized);
    this.pendingFlush.push(serialized);
  }

  private handleBpmChange(_ws: WebSocket, bpm: number): void {
    this.roomState.bpm = bpm;
    this.roomState.serverTime = Date.now();
    void this.ctx.storage.put('roomState', this.roomState);
    this.broadcastAll(JSON.stringify({
      type: 'room_state',
      roomState: this.roomState,
      peers: Array.from(this.peers.values()).map((c) => c.peer),
    }));
  }

  private handleKeyChange(_ws: WebSocket, key: string): void {
    this.roomState.key = key;
    this.roomState.serverTime = Date.now();
    void this.ctx.storage.put('roomState', this.roomState);
    this.broadcastAll(JSON.stringify({
      type: 'room_state',
      roomState: this.roomState,
      peers: Array.from(this.peers.values()).map((c) => c.peer),
    }));
  }

  private handleClockSyncPing(ws: WebSocket, _t0: number): void {
    const t1 = Date.now(); // server receive time
    this.send(ws, {
      type: 'clock_sync_pong',
      t1,
      t2: Date.now(), // server send time
    });
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  private send(ws: WebSocket, data: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Peer already disconnected
    }
  }

  /** Broadcast to all peers EXCEPT the sender */
  private broadcast(sender: WebSocket, data: string | Record<string, unknown>): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [ws] of this.peers) {
      if (ws === sender) continue;
      try { ws.send(message); } catch { /* peer disconnected */ }
    }
  }

  /** Broadcast to ALL peers including sender */
  private broadcastAll(message: string): void {
    for (const [ws] of this.peers) {
      try { ws.send(message); } catch { /* peer disconnected */ }
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message });
  }

  /** Batch-insert pending note events to SQLite — runs every FLUSH_INTERVAL_MS */
  private async flushToSQLite(): Promise<void> {
    if (this.pendingFlush.length === 0) return;

    const batch = this.pendingFlush.splice(0);

    try {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS note_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )`,
      );

      for (const raw of batch) {
        this.ctx.storage.sql.exec(
          'INSERT INTO note_events (data) VALUES (?)',
          raw,
        );
      }
    } catch (err) {
      // Log but don't crash — note events are ephemeral
      console.error('[JamRoom] flushToSQLite failed:', err);
      // Re-queue failed batch for next attempt
      this.pendingFlush.unshift(...batch);
    }
  }
}
