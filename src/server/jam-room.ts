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
import { generateMeasure, type AgentStyle, type GeneratedNote } from '@/shared/music';
import { repairMeasure } from './measure-repair';
import {
  generateMeasureWithAi,
  FREE_MODEL,
  SIGNED_MODEL,
  isFreeModel,
  isKnownModel,
  type AiCallMeta,
  type Tier,
} from './llm-planner';
import { decideWithJev, jevConfigFromEnv, type JevState } from './jev';

/** Set by the Worker entry on the upgrade request, computed from the door's answer. */
const TIER_HEADER = 'x-jam-tier';

/** Env bindings defined in wrangler.jsonc, plus the signed-in decision layer's secrets. */
interface Env {
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<{ response?: unknown }> };
  JEV_ENDPOINT?: string;
  JEV_MODEL?: string;
  JEV_API_KEY?: string;
}

interface PeerConnection {
  peer: Peer;
  ws: WebSocket;
  activeNotes: Set<string>; // pitches currently held, for MIDI panic
  noteCount: number; // rate limiter, notes in current window
  lastNoteWindow: number; // timestamp of current rate-limit window start
}

interface InProcessAgent {
  peer: Peer;
  style: AgentStyle;
  model: string;
  /** who spawned it: a public agent renders notes, a signed-in agent is judged by Jev first */
  tier: Tier;
  /** a decision or a render already in flight: a measure that cannot fit is skipped, never queued */
  busy: boolean;
  /**
   * THE BAR QUEUE, two deep. Bars are rendered AHEAD of the bar playing and published on the bar line,
   * so the model's latency never reaches the grid. Two slots matter: one render that overruns its bar
   * (measured tails of 2-3s on llama-3.2-3b) would otherwise leave a random pattern bar between two
   * model bars, which is the incoherence a listener hears immediately. An entry whose bar has already
   * started is dropped, never played late.
   */
  queue: Array<{ bar: number; notes: GeneratedNote[]; meta: AiCallMeta | null }>;
  /** fires on the next bar boundary of the ROOM's transport, not on a timer started at spawn */
  barTimer: ReturnType<typeof setTimeout> | null;
  activeNotes: Set<string>;
  noteCount: number;
}

/**
 * JamRoom Durable Object, the central hub for a jam session.
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

      // THE TIER RIDES THE SOCKET, not the message: it was computed by the Worker entry from the
      // door's answer and attached here, so a client message can never promote itself to signed.
      const tier: Tier = request.headers.get(TIER_HEADER) === 'signed' ? 'signed' : 'public';
      try { server.serializeAttachment({ tier }); } catch { /* attachment is an optimisation */ }

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
        if (!agent) break;
        const requested = (msg as { model: string }).model;
        // A RETIRED SLUG IS NOT A MODEL. Accepting one only produces a silent fallback forever, so
        // the room refuses what the list does not carry.
        if (!isKnownModel(requested)) {
          this.sendError(ws, `Unknown model: ${requested}`);
          break;
        }
        // AN ANONYMOUS ROOM MAY NOT BILL A LARGER MODEL. The public tier is a budget, not a hint:
        // the free model is the only one an unauthenticated socket can select.
        if (agent.tier === 'public' && !isFreeModel(requested)) {
          this.sendError(ws, 'Sign in to choose a larger model');
          break;
        }
        agent.model = requested;
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

    // NOBODY IS LISTENING, SO NOTHING MAY BE PLAYING. An in-process agent has no client to control
    // it, and every measure it renders is a billed Workers AI call (plus a Jev decision for a signed
    // room). Leaving one running after the last peer left would spend unattended, forever.
    if (this.peers.size === 0 && this.agents.size > 0) {
      for (const agent of this.agents.values()) {
        if (agent.barTimer) clearTimeout(agent.barTimer);
      }
      for (const agentPeerId of this.agents.keys()) {
        this.broadcastAll(JSON.stringify({ type: 'peer_left', peerId: agentPeerId }));
      }
      this.agents.clear();
    }

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

    // Relay raw string to all OTHER peers, zero JSON.parse overhead
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

    // Re-arm every agent on the new grid. A bar in flight belongs to the old tempo, so the buffer is
    // dropped rather than stretched.
    for (const agent of this.agents.values()) {
      if (agent.barTimer) clearTimeout(agent.barTimer);
      // The queue holds notes addressed to the OLD tempo's grid, so it is dropped, not stretched.
      agent.queue = [];
      this.armAgentBar(agent);
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

    const tier = this.tierOf(ws);

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
      model: tier === 'signed' ? SIGNED_MODEL : FREE_MODEL,
      tier,
      busy: false,
      // Nothing is queued at spawn: the first boundary plays a pattern bar (never silence) while two
      // model renders fill the queue behind it.
      queue: [],
      barTimer: null,
      activeNotes: new Set(),
      noteCount: 0,
    };

    this.armAgentBar(agent);
    this.agents.set(peer.peerId, agent);
    // START THE FIRST RENDER NOW, not on the first boundary: the queue is empty at spawn, and waiting
    // for the bar line would cost the room a pattern bar before the first model bar.
    void this.renderAgentBar(agent);

    // Start intervals if this is the first entity
    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => this.flushToSQLite(), FLUSH_INTERVAL_MS);
      this.metricsInterval = setInterval(() => this.broadcastMetrics(), METRICS_INTERVAL_MS);
    }

    // Broadcast agent_spawned + peer_joined to all WS peers
    this.broadcastAll(JSON.stringify({ type: 'agent_spawned', peer, style, tier }));
    this.broadcastAll(JSON.stringify({ type: 'peer_joined', peer }));
  }

  private handleDespawnAgent(_ws: WebSocket, agentPeerId: string): void {
    const agent = this.agents.get(agentPeerId);
    if (!agent) return;

    if (agent.barTimer) clearTimeout(agent.barTimer);

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

  /** The tier the socket was handed at upgrade; a session that lost its attachment is public. */
  private tierOf(ws: WebSocket): Tier {
    try {
      const a = ws.deserializeAttachment?.() as { tier?: Tier } | undefined;
      return a?.tier === 'signed' ? 'signed' : 'public';
    } catch {
      return 'public';
    }
  }

  // ─── The bar clock ─────────────────────────────────────────────────────────
  //
  // MEASURED BEFORE THIS EXISTED (12 live bars, 2026-10-29): the agent's notes landed a median of
  // 923ms (worst 1555ms) after the slot its own beatTime named, on a 2000ms bar. The cause was not
  // the model: notes were scheduled `beatTime * beatMs` from the instant the API call RETURNED, and
  // the bar timer was a free-running interval started at spawn. So the agent played half a bar behind
  // the human, every bar.
  //
  // The fix is a bar clock on the ROOM's transport plus a one-bar buffer: a bar is rendered during the
  // bar before it, published on the bar line, and its notes are addressed to absolute slots. Latency
  // now costs a bar of freshness, never a bar of phase.

  private barMs(): number {
    return (60 / this.roomState.bpm) * 4 * 1000;
  }

  private barIndexOf(at: number): number {
    return Math.floor((at - this.roomState.transportStartTime) / this.barMs());
  }

  /** The instant of the next bar line of the room's transport, as server time. */
  private nextBarStart(from: number = Date.now()): number {
    const bar = this.barMs();
    const elapsed = from - this.roomState.transportStartTime;
    return this.roomState.transportStartTime + (Math.floor(elapsed / bar) + 1) * bar;
  }

  private armAgentBar(agent: InProcessAgent): void {
    const wait = Math.max(0, this.nextBarStart() - Date.now());
    agent.barTimer = setTimeout(() => this.onAgentBar(agent), wait);
  }

  /** One bar boundary: publish the bar that was prepared, then render the next one. */
  private onAgentBar(agent: InProcessAgent): void {
    agent.barTimer = null;
    if (!this.agents.has(agent.peer.peerId)) return;

    const bar = this.barIndexOf(Date.now());
    const beatMs = (60 / this.roomState.bpm) * 1000;

    // PUBLISH. An entry queued for THIS bar plays; anything else is a bar the model missed, and the
    // pattern generator covers it rather than shifting a stale bar into the present.
    const index = agent.queue.findIndex(q => q.bar === bar);
    const ready = index === -1 ? null : agent.queue.splice(index, 1)[0] ?? null;
    const notes = ready?.notes ?? generateMeasure(agent.style, this.roomState.key, this.roomState.bpm);
    const meta = ready?.meta ?? this.patternMeta(agent, notes, 'pattern bar, the queue was empty');

    this.emitAgentBar(agent, notes, bar, beatMs);

    this.broadcastAll(JSON.stringify({
      type: 'ai_debug',
      agentPeerId: agent.peer.peerId,
      agentName: agent.peer.name,
      meta,
    }));

    // REFILL. Two slots means a slow render costs freshness, not the next bar's coherence.
    if (agent.queue.length < 2) void this.renderAgentBar(agent);

    this.armAgentBar(agent);
  }

  /** Notes addressed to absolute slots on the room's grid, so a late scheduler writes no phase error. */
  private emitAgentBar(agent: InProcessAgent, notes: GeneratedNote[], bar: number, beatMs: number): void {
    const barStart = this.roomState.transportStartTime + bar * this.barMs();
    const latestUseful = -beatMs / 4; // a sixteenth late is no longer on its slot
    agent.noteCount = 0;

    for (const note of notes) {
      const onDelay = barStart + note.beatTime * beatMs - Date.now();
      if (onDelay < latestUseful) continue;

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
      }, Math.max(0, onDelay));

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
      }, Math.max(0, onDelay + note.duration * beatMs));
    }
  }

  /**
   * Render the bar after the one now playing. One call, one battery: Jev decides, the model writes,
   * the repairer puts it in key and on the grid, and the result waits in the buffer.
   */
  private async renderAgentBar(agent: InProcessAgent): Promise<void> {
    if (agent.busy) return;
    agent.busy = true;

    try {
      // What someone else is holding RIGHT NOW may not be doubled by this bar.
      const heldPitches = this.heldByOthers(agent.peer.peerId);
      const recentNotes = this.recentNotes(agent.peer.peerId);

      const jev = agent.tier === 'signed' ? jevConfigFromEnv(this.env) : null;
      const brief = jev
        ? await decideWithJev(jev, {
            key: this.roomState.key,
            bpm: this.roomState.bpm,
            style: agent.style,
            recentNotes,
            peers: this.peers.size + this.agents.size,
          } satisfies JevState)
        : null;

      const ctx = {
        key: this.roomState.key,
        bpm: this.roomState.bpm,
        style: agent.style,
        recentNotes,
        currentBeat: 0,
      };

      const result = await generateMeasureWithAi(this.env.AI, ctx, agent.model, brief, agent.tier);
      const repaired = repairMeasure(result.notes, {
        key: this.roomState.key,
        heldPitches,
        maxNotes: 10,
      });

      // The bar this belongs to: the first one that is neither playing nor already queued.
      const queuedMax = agent.queue.reduce((max, q) => Math.max(max, q.bar), 0);
      const target = Math.max(this.barIndexOf(Date.now()) + 1, queuedMax + 1);
      agent.queue.push({
        bar: target,
        notes: repaired.notes,
        meta: { ...result.meta, noteCount: repaired.notes.length },
      });
      agent.queue.sort((a, b) => a.bar - b.bar);
      agent.queue = agent.queue.slice(0, 2);
    } finally {
      agent.busy = false;
    }
  }

  private patternMeta(agent: InProcessAgent, notes: GeneratedNote[], why: string): AiCallMeta {
    return {
      source: 'pattern', tier: agent.tier, model: agent.model, decider: 'none', brief: null,
      prompt: '(pattern bar)', response: `(${why})`,
      noteCount: notes.length, latencyMs: 0,
    };
  }

  /** Pitches another peer is holding, which a new bar must not duplicate. */
  private heldByOthers(agentPeerId: string): string[] {
    const held = new Set<string>();
    for (const conn of this.peers.values()) {
      for (const pitch of conn.activeNotes) held.add(pitch);
    }
    for (const other of this.agents.values()) {
      if (other.peer.peerId === agentPeerId) continue;
      for (const pitch of other.activeNotes) held.add(pitch);
    }
    return [...held];
  }

  /** What everyone but this agent played recently, flattened for the prompt and for Jev. */
  private recentNotes(agentPeerId: string): Array<{ pitch: string; peerId: string; beatTime: number }> {
    return this.pendingFlush
      .map(raw => { try { return JSON.parse(raw); } catch { return null; } })
      .filter((e): e is NoteEvent => e?.type === 'note_on' && e?.peerId !== agentPeerId)
      .slice(-20)
      .map(e => ({ pitch: e.pitch, peerId: e.peerId, beatTime: e.beatTime }));
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
      // Table may not exist yet, that's fine
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

  /** Batch-insert pending note events to SQLite, runs every FLUSH_INTERVAL_MS */
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
