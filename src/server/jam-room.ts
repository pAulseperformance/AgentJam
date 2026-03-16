import {
  DEFAULT_BPM,
  DEFAULT_KEY,
  PEER_COLORS,
  NOTE_EVENT_TYPE_MARKER,
  FLUSH_INTERVAL_MS,
  MAX_NOTES_PER_SECOND,
  MAX_AGENTS_PER_ROOM,
  METRICS_INTERVAL_MS,
  BACKFILL_WINDOW_MS,
  WS_CLOSE_NORMAL,
} from '@/shared/protocol/constants';
import {
  ClientMessageSchema,
  type Peer,
  type RoomState,
  type NoteEvent,
  type PeerMetrics,
} from '@/shared/protocol/types';
import { generateMeasure, type AgentStyle } from '@/shared/music';
import { generateMeasureWithAi } from './llm-planner';

/** Env bindings defined in wrangler.jsonc */
interface Env {
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<{ response?: string }> };
}

interface PeerConnection {
  peer: Peer;
  ws: WebSocket;
  activeNotes: Set<string>; // pitches currently held — for MIDI panic
  noteCount: number; // rate limiter — notes in current window
  lastNoteWindow: number; // timestamp of current rate-limit window start
}

interface InProcessAgent {
  peer: Peer;
  style: AgentStyle;
  model: string;
  measureTimer: ReturnType<typeof setInterval>;
  activeNotes: Set<string>;
  noteCount: number;
}

/**
 * JamRoom Durable Object — the central hub for a jam session.
 *
 * Phase 3 additions:
 * - In-process agent spawning (TAS-104)
 * - Reconnection event backfill (TAS-105)
 * - Metrics snapshot broadcasting (TAS-106)
 */
export class JamRoom implements DurableObject {
  private peers: Map<WebSocket, PeerConnection> = new Map();
  private roomState: RoomState;
  private colorIndex = 0;
  private pendingFlush: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private metricsInterval: ReturnType<typeof setInterval> | null = null;
  private agents: Map<string, InProcessAgent> = new Map();
  private startTime = Date.now();
  private env: Env;
  private isRecording = false;
  private recordingStartTime: number | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = env;
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
        agents: this.agents.size,
        bpm: this.roomState.bpm,
        key: this.roomState.key,
        uptimeMs: Date.now() - this.startTime,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ─── Hibernation API Callbacks ──────────────────────────────────────────────

  webSocketOpen(ws: WebSocket): void {
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
      case 'spawn_agent':
        this.handleSpawnAgent(ws, msg.name, msg.style);
        break;
      case 'despawn_agent':
        this.handleDespawnAgent(ws, msg.agentPeerId);
        break;
      case 'instrument_change':
        // Broadcast to all peers so they can update per-peer synth routing
        this.broadcastAll(JSON.stringify({
          type: 'instrument_change',
          peerId: this.findPeerIdByWs(ws),
          instrument: msg.instrument,
        }));
        break;
      case 'recording_start':
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.broadcastAll(JSON.stringify({
          type: 'recording_status',
          isRecording: true,
          startTime: this.recordingStartTime,
        }));
        break;
      case 'recording_stop':
        this.isRecording = false;
        this.broadcastAll(JSON.stringify({
          type: 'recording_status',
          isRecording: false,
          startTime: this.recordingStartTime,
        }));
        break;
      case 'set_agent_model': {
        const agent = this.agents.get((msg as { agentPeerId: string }).agentPeerId);
        if (agent) {
          agent.model = (msg as { model: string }).model;
        }
        break;
      }
      case 'note_on':
      case 'note_off':
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

    // Start intervals on first peer
    if (this.peers.size === 1 && !this.flushInterval) {
      this.flushInterval = setInterval(() => this.flushToSQLite(), FLUSH_INTERVAL_MS);
      this.metricsInterval = setInterval(() => this.broadcastMetrics(), METRICS_INTERVAL_MS);
    }

    // Send room state + full peer list (including agents) to the new peer
    this.roomState.serverTime = Date.now();
    const allPeers = this.getAllPeers();

    this.send(ws, {
      type: 'room_state',
      roomState: this.roomState,
      peers: allPeers,
    });

    // Send event backfill if we have recent events
    this.sendBackfill(ws);

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
          beatTime: 0,
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

    // Clean up intervals if room is empty (no WS peers and no agents)
    if (this.peers.size === 0 && this.agents.size === 0) {
      this.cleanupIntervals();
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
    if (conn.noteCount > MAX_NOTES_PER_SECOND) return;

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

    // Restart all agent measure timers at new BPM
    for (const agent of this.agents.values()) {
      clearInterval(agent.measureTimer);
      agent.measureTimer = this.createAgentMeasureTimer(agent);
    }

    this.broadcastAll(JSON.stringify({
      type: 'room_state',
      roomState: this.roomState,
      peers: this.getAllPeers(),
    }));
  }

  private handleKeyChange(_ws: WebSocket, key: string): void {
    this.roomState.key = key;
    this.roomState.serverTime = Date.now();
    void this.ctx.storage.put('roomState', this.roomState);
    this.broadcastAll(JSON.stringify({
      type: 'room_state',
      roomState: this.roomState,
      peers: this.getAllPeers(),
    }));
  }

  private handleClockSyncPing(ws: WebSocket, _t0: number): void {
    const t1 = Date.now();
    this.send(ws, {
      type: 'clock_sync_pong',
      t1,
      t2: Date.now(),
    });
  }

  // ─── TAS-104: In-Process Agent Spawning ─────────────────────────────────────

  private handleSpawnAgent(ws: WebSocket, name: string, style: AgentStyle): void {
    if (this.agents.size >= MAX_AGENTS_PER_ROOM) {
      this.sendError(ws, `Max ${MAX_AGENTS_PER_ROOM} agents per room`);
      return;
    }

    const color = PEER_COLORS[this.colorIndex % PEER_COLORS.length] ?? '#6366f1';
    this.colorIndex++;

    const peer: Peer = {
      peerId: crypto.randomUUID(),
      name,
      kind: 'agent',
      instrument: 'PolySynth',
      color,
    };

    const agent: InProcessAgent = {
      peer,
      style,
      model: '@cf/meta/llama-3.1-8b-instruct',
      measureTimer: 0 as unknown as ReturnType<typeof setInterval>, // set below
      activeNotes: new Set(),
      noteCount: 0,
    };

    agent.measureTimer = this.createAgentMeasureTimer(agent);
    this.agents.set(peer.peerId, agent);

    // Start intervals if this is the first entity
    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => this.flushToSQLite(), FLUSH_INTERVAL_MS);
      this.metricsInterval = setInterval(() => this.broadcastMetrics(), METRICS_INTERVAL_MS);
    }

    // Broadcast agent_spawned + peer_joined to all WS peers
    this.broadcastAll(JSON.stringify({ type: 'agent_spawned', peer, style }));
    this.broadcastAll(JSON.stringify({ type: 'peer_joined', peer }));
  }

  private handleDespawnAgent(_ws: WebSocket, agentPeerId: string): void {
    const agent = this.agents.get(agentPeerId);
    if (!agent) return;

    clearInterval(agent.measureTimer);

    // MIDI panic for agent's active notes
    const now = Date.now();
    for (const pitch of agent.activeNotes) {
      this.broadcastAll(JSON.stringify({
        type: 'note_off',
        peerId: agent.peer.peerId,
        pitch,
        beatTime: 0,
        velocity: 0,
        timestamp: now,
      }));
    }

    this.agents.delete(agentPeerId);

    this.broadcastAll(JSON.stringify({
      type: 'peer_left',
      peerId: agentPeerId,
    }));

    // Clean up if room is empty
    if (this.peers.size === 0 && this.agents.size === 0) {
      this.cleanupIntervals();
    }
  }

  private createAgentMeasureTimer(agent: InProcessAgent): ReturnType<typeof setInterval> {
    const measureDurationMs = (60 / this.roomState.bpm) * 4 * 1000;

    return setInterval(() => {
      this.agentGenerateMeasure(agent);
    }, measureDurationMs);
  }

  private agentGenerateMeasure(agent: InProcessAgent): void {
    // Collect recent notes from the event buffer for LLM context
    const recentNotes = this.pendingFlush
      .map(raw => { try { return JSON.parse(raw); } catch { return null; } })
      .filter((e): e is NoteEvent => e?.type === 'note_on' && e?.peerId !== agent.peer.peerId)
      .slice(-20)
      .map(e => ({ pitch: e.pitch, peerId: e.peerId, beatTime: e.beatTime }));

    // Try LLM generation (async), fall back to pattern generator
    void generateMeasureWithAi(this.env.AI, {
      key: this.roomState.key,
      bpm: this.roomState.bpm,
      style: agent.style,
      recentNotes,
      currentBeat: 0,
    }, agent.model).then(result => {
      this.scheduleAgentNotes(agent, result.notes);

      // Broadcast AI debug metadata to all connected peers
      this.broadcastAll(JSON.stringify({
        type: 'ai_debug',
        agentPeerId: agent.peer.peerId,
        agentName: agent.peer.name,
        meta: result.meta,
      }));
    });
  }

  private scheduleAgentNotes(agent: InProcessAgent, notes: ReturnType<typeof generateMeasure>): void {
    const beatDurationMs = (60 / this.roomState.bpm) * 1000;

    agent.noteCount = 0;

    for (const note of notes) {
      const delayMs = note.beatTime * beatDurationMs;

      // Schedule note_on
      setTimeout(() => {
        const noteOn = JSON.stringify({
          type: 'note_on',
          peerId: agent.peer.peerId,
          pitch: note.pitch,
          beatTime: note.beatTime,
          velocity: note.velocity,
          timestamp: Date.now(),
        });
        agent.activeNotes.add(note.pitch);
        agent.noteCount++;
        this.broadcastAll(noteOn);
        this.pendingFlush.push(noteOn);
      }, delayMs);

      // Schedule note_off
      setTimeout(() => {
        const noteOff = JSON.stringify({
          type: 'note_off',
          peerId: agent.peer.peerId,
          pitch: note.pitch,
          beatTime: note.beatTime + note.duration,
          velocity: 0,
          timestamp: Date.now(),
        });
        agent.activeNotes.delete(note.pitch);
        this.broadcastAll(noteOff);
        this.pendingFlush.push(noteOff);
      }, delayMs + note.duration * beatDurationMs);
    }
  }

  // ─── TAS-105: Reconnection Backfill ─────────────────────────────────────────

  private sendBackfill(ws: WebSocket): void {
    try {
      this.ensureNoteEventsTable();
      const cutoff = Date.now() - BACKFILL_WINDOW_MS;
      const rows = this.ctx.storage.sql.exec(
        'SELECT data FROM note_events WHERE created_at > ? ORDER BY created_at ASC LIMIT 200',
        Math.floor(cutoff / 1000),
      );

      const events: NoteEvent[] = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data as string) as NoteEvent;
          events.push(parsed);
        } catch { /* skip malformed */ }
      }

      if (events.length > 0) {
        this.send(ws, {
          type: 'event_backfill',
          events,
          backfillFromTimestamp: cutoff,
        });
      }
    } catch {
      // Table may not exist yet — that's fine
    }
  }

  // ─── TAS-106: Metrics Broadcast ─────────────────────────────────────────────

  private broadcastMetrics(): void {
    if (this.peers.size === 0) return;

    const peerMetrics: PeerMetrics[] = [];

    // WS peer metrics
    for (const conn of this.peers.values()) {
      peerMetrics.push({
        peerId: conn.peer.peerId,
        notesPerSec: conn.noteCount,
        activeNoteCount: conn.activeNotes.size,
      });
    }

    // Agent metrics
    for (const agent of this.agents.values()) {
      peerMetrics.push({
        peerId: agent.peer.peerId,
        notesPerSec: agent.noteCount,
        activeNoteCount: agent.activeNotes.size,
      });
    }

    const totalNotesPerSec = peerMetrics.reduce((sum, m) => sum + m.notesPerSec, 0);

    this.broadcastAll(JSON.stringify({
      type: 'metrics_snapshot',
      peerCount: this.peers.size + this.agents.size,
      agentCount: this.agents.size,
      totalNotesPerSec,
      peerMetrics,
      uptimeMs: Date.now() - this.startTime,
      serverTime: Date.now(),
      isRecording: this.isRecording,
    }));
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /** Get all peers: WS connections + in-process agents */
  private getAllPeers(): Peer[] {
    const wsPeers = Array.from(this.peers.values()).map(c => c.peer);
    const agentPeers = Array.from(this.agents.values()).map(a => a.peer);
    return [...wsPeers, ...agentPeers];
  }

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

  /** Broadcast to ALL WS peers (optionally exclude one) */
  private broadcastAll(message: string, exclude?: WebSocket): void {
    for (const [ws] of this.peers) {
      if (ws === exclude) continue;
      try { ws.send(message); } catch { /* peer disconnected */ }
    }
  }

  /** Look up peerId from a WS reference */
  private findPeerIdByWs(ws: WebSocket): string {
    for (const [peerWs, conn] of this.peers) {
      if (peerWs === ws) return conn.peer.peerId;
    }
    return 'unknown';
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message });
  }

  private cleanupIntervals(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
      void this.flushToSQLite();
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  private ensureNoteEventsTable(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS note_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
    );
  }

  /** Batch-insert pending note events to SQLite — runs every FLUSH_INTERVAL_MS */
  private async flushToSQLite(): Promise<void> {
    if (this.pendingFlush.length === 0) return;

    const batch = this.pendingFlush.splice(0);

    try {
      this.ensureNoteEventsTable();

      for (const raw of batch) {
        this.ctx.storage.sql.exec(
          'INSERT INTO note_events (data) VALUES (?)',
          raw,
        );
      }
    } catch (err) {
      console.error('[JamRoom] flushToSQLite failed:', err);
      this.pendingFlush.unshift(...batch);
    }
  }
}
