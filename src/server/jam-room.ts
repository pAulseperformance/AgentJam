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
import {
  generateMeasure,
  midiOf,
  noteNameFromMidi,
  scalePitchClasses,
  type AgentStyle,
  type GeneratedNote,
} from '@/shared/music';
import { repairMeasure } from './measure-repair';
import { summarizePhrase, motifFrom, describePhrase, describeMotif, type Motif, type NoteRecord } from './listener';
import { drumBar, bassBar, countInBar } from './groove';
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

/**
 * The note a partner answers with: a consonant interval above what you played, whichever of those is
 * in the key. A third or a fourth, never a copy, so an echo sounds like a reply and not a loop.
 */
function answerPitchFor(pitch: string, key: string): string | null {
  const midi = midiOf(pitch);
  if (midi === null) return null;
  const allowed = new Set(scalePitchClasses(key));
  for (const interval of [3, 4, 5, 7]) {
    const candidate = Math.min(100, midi + interval);
    const pc = ((candidate % 12) + 12) % 12;
    if (allowed.has(pc)) return noteNameFromMidi(candidate);
  }
  return null;
}

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

/**
 * THE RHYTHM SECTION. A drummer and a bass player are peers, not models: fixed patterns and the same
 * bar clock the lead agent uses. They exist so the room has a spine before it has a soloist, and so
 * the tempo is set by something that never gets it wrong.
 */
interface RoomLayer {
  peer: Peer;
  role: 'drummer' | 'bass';
  style: AgentStyle;
  barTimer: ReturnType<typeof setTimeout> | null;
  /** bars this layer has played, which is what varies the pattern */
  bars: number;
  activeNotes: Set<string>;
  noteCount: number;
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
  /** the last four bars: true where it sounded, so it can notice it is over-playing */
  recentBars: boolean[];
  /** bars played since the last rest, so the rest policy below can bound them */
  barsSinceRest: number;
  /** comping budget: at most two reactive echoes in a bar, and which bar they belong to */
  echoesThisBar: number;
  lastEchoBar: number;
  /**
   * ITS OWN LAST STATEMENT. A partner keeps an idea going; a generator starts over every bar. The
   * motif is what the decision layer may restate or vary, and what the model is told to keep.
   */
  motif: Motif | null;
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
  /**
   * WHAT THE ROOM JUST PLAYED, kept in memory and NOT drained by the 5s persistence flush. The agent's
   * context used to be read out of `pendingFlush`, which the flush empties, so every few seconds the
   * next bar was generated against an empty room.
   */
  private noteRing: NoteRecord[] = [];
  /** The rhythm section, keyed by its role. At most one drummer and one bass player per room. */
  private layers: Map<'drummer' | 'bass', RoomLayer> = new Map();

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
      case 'set_backing':
        this.handleSetBacking(msg.drummer, msg.bass);
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
    if (this.peers.size === 0 && this.layers.size > 0) {
      for (const role of [...this.layers.keys()]) this.despawnLayer(role);
    }

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

    // Record for the agents' listener. Only when an agent exists: a room with no agent pays nothing,
    // which is why this parse is allowed on the hot path at all.
    if (this.agents.size > 0) {
      const parsed = this.recordNote(rawMessage);
      if (parsed) this.maybeComp(parsed);
    }

    // Relay raw string to all OTHER peers, zero JSON.parse overhead for the relay itself
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
    this.recordEvent(msg);
    if (msg.type === 'note_on' && this.agents.size > 0) this.maybeComp(msg as NoteRecord);
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
    for (const layer of this.layers.values()) {
      if (layer.barTimer) clearTimeout(layer.barTimer);
      this.armLayerBar(layer);
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
      recentBars: [],
      barsSinceRest: 99,
      echoesThisBar: 0,
      lastEchoBar: -1,
      motif: null,
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

  /** Keep the last ~2 bars of everyone's notes in memory for the agents to hear. */
  private recordNote(raw: string): NoteRecord | null {
    try {
      const event = JSON.parse(raw) as NoteRecord;
      this.recordEvent(event);
      return event;
    } catch {
      return null;
    }
  }

  private recordEvent(event: NoteRecord): void {
    if (!event || (event.type !== 'note_on' && event.type !== 'note_off')) return;
    this.noteRing.push({
      peerId: event.peerId,
      type: event.type,
      pitch: event.pitch,
      beatTime: event.beatTime,
      velocity: event.velocity,
      duration: event.duration ?? 0.5,
      timestamp: event.timestamp || Date.now(),
    });
    // Two bars is the whole window a partner listens to; anything older is noise in the prompt.
    const keep = Math.max(24, Math.ceil(this.barMs() / Math.max(1, this.roomState.bpm)) * 96);
    if (this.noteRing.length > keep) this.noteRing.splice(0, this.noteRing.length - keep);
  }

  /** Everything someone ELSE played in the last two bars, as events the listener can summarize. */
  private othersRecent(agentPeerId: string): NoteRecord[] {
    const since = Date.now() - this.barMs() * 2;
    return this.noteRing.filter(n => n.peerId !== agentPeerId && n.timestamp >= since);
  }

  // ─── The rhythm section ────────────────────────────────────────────────────

  /**
   * Turn the rhythm section on or off. Both are the room's, not a peer's: they keep playing while
   * anyone is listening and stop with the room, which is the same spend rule the lead agent follows.
   */
  private handleSetBacking(drummer: boolean, bass: boolean): void {
    if (drummer && !this.layers.has('drummer')) this.spawnLayer('drummer');
    if (!drummer) this.despawnLayer('drummer');
    if (bass && !this.layers.has('bass')) this.spawnLayer('bass');
    if (!bass) this.despawnLayer('bass');
  }

  private spawnLayer(role: 'drummer' | 'bass'): void {
    const color = PEER_COLORS[this.colorIndex % PEER_COLORS.length] ?? '#6366f1';
    this.colorIndex++;

    const peer: Peer = {
      peerId: crypto.randomUUID(),
      name: role === 'drummer' ? 'Drummer' : 'Bass',
      kind: 'agent',
      instrument: role === 'drummer' ? 'MembraneSynth' : 'PolySynth',
      color,
    };

    const layer: RoomLayer = {
      peer,
      role,
      // The rhythm section matches the lead agent's style when there is one, otherwise jazz.
      style: [...this.agents.values()][0]?.style ?? 'jazz',
      barTimer: null,
      bars: 0,
      activeNotes: new Set(),
      noteCount: 0,
    };

    this.layers.set(role, layer);
    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => this.flushToSQLite(), FLUSH_INTERVAL_MS);
      this.metricsInterval = setInterval(() => this.broadcastMetrics(), METRICS_INTERVAL_MS);
    }

    this.broadcastAll(JSON.stringify({ type: 'agent_spawned', peer, style: layer.style, tier: 'public' }));
    this.broadcastAll(JSON.stringify({ type: 'peer_joined', peer }));
    this.armLayerBar(layer);
  }

  private despawnLayer(role: 'drummer' | 'bass'): void {
    const layer = this.layers.get(role);
    if (!layer) return;

    if (layer.barTimer) clearTimeout(layer.barTimer);
    this.panicLayer(layer);
    this.layers.delete(role);
    this.broadcastAll(JSON.stringify({ type: 'peer_left', peerId: layer.peer.peerId }));
    if (this.peers.size === 0 && this.agents.size === 0 && this.layers.size === 0) {
      this.cleanupIntervals();
    }
  }

  /** Release anything a layer is holding, so a despawn never leaves a stuck note. */
  private panicLayer(layer: RoomLayer): void {
    if (layer.activeNotes.size === 0) return;
    const now = Date.now();
    for (const pitch of layer.activeNotes) {
      this.broadcastAll(JSON.stringify({
        type: 'note_off', peerId: layer.peer.peerId, pitch, beatTime: 0, velocity: 0, timestamp: now,
      }));
    }
    layer.activeNotes.clear();
  }

  private armLayerBar(layer: RoomLayer): void {
    const wait = Math.max(0, this.nextBarStart() - Date.now());
    layer.barTimer = setTimeout(() => this.onLayerBar(layer), wait);
  }

  private onLayerBar(layer: RoomLayer): void {
    layer.barTimer = null;
    if (this.layers.get(layer.role) !== layer) return;

    const bar = this.barIndexOf(Date.now());
    const beatMs = (60 / this.roomState.bpm) * 1000;

    // A DRUMMER COUNTS THE ROOM IN before it accompanies: four quarters, so the tempo is heard and
    // not just assumed.
    const notes = layer.role === 'drummer' && layer.bars === 0
      ? countInBar(layer.style)
      : layer.role === 'drummer'
        ? drumBar(layer.style, bar)
        : bassBar(layer.style, this.roomState.key, bar);

    layer.noteCount = 0;
    this.emitBar(layer.peer, notes, bar, beatMs, {
      activeNotes: layer.activeNotes,
      addNoteCount: () => { layer.noteCount++; },
    });

    layer.bars++;
    this.armLayerBar(layer);
  }

  // ─── Comping: the sub-second answer ────────────────────────────────────────
  //
  // A composed bar answers at the bar line, which is up to two seconds later. A partner also reacts
  // inside the beat: the streaming-accompaniment work is explicit that a large chunk buys stability
  // and costs reactivity, so the reactive half has to be a separate, smaller chunk (arXiv 2510.22105).
  // This is that small chunk: one echo, on the next eighth, in key, never a unison, at most twice a
  // bar. It is deterministic, so it costs nothing and never arrives late.

  private maybeComp(event: NoteRecord): void {
    const agent = [...this.agents.values()][0];
    if (!agent) return;
    if (this.barIndexOf(Date.now()) === agent.lastEchoBar && agent.echoesThisBar >= 2) return;

    const theirMidi = midiOf(event.pitch);
    if (theirMidi === null) return;

    // ECHO A THIRD OR A FOURTH ABOVE, whichever is in the key: a partner answers with a consonant
    // interval, not a copy.
    const answer = answerPitchFor(event.pitch, this.roomState.key);
    if (!answer) return;

    const beatMs = (60 / this.roomState.bpm) * 1000;
    const eighth = beatMs / 2;
    const now = Date.now();
    let at = this.roomState.transportStartTime
      + (Math.ceil((now - this.roomState.transportStartTime) / eighth) + 1) * eighth;
    if (at - now < 40) at += eighth; // never schedule a note the scheduler itself would be late for

    const delay = at - now;
    if (delay > eighth * 2) return; // a reaction that takes longer than a beat is not a reaction

    const bar = this.barIndexOf(at);
    if (bar !== this.barIndexOf(Date.now())) return; // do not echo across a bar line

    const velocity = Math.max(40, Math.min(110, Math.round(event.velocity || 80) - 8));
    agent.echoesThisBar = bar === agent.lastEchoBar ? agent.echoesThisBar + 1 : 1;
    agent.lastEchoBar = bar;

    setTimeout(() => {
      const noteOn = JSON.stringify({
        type: 'note_on', peerId: agent.peer.peerId, pitch: answer,
        beatTime: Math.round(((Date.now() - this.roomState.transportStartTime) % this.barMs()) / beatMs * 4) / 4,
        velocity, timestamp: Date.now(),
      });
      agent.activeNotes.add(answer);
      this.broadcastAll(noteOn);
      this.pendingFlush.push(noteOn);
      this.recordEvent({ type: 'note_on', peerId: agent.peer.peerId, pitch: answer, beatTime: 0, velocity, timestamp: Date.now() });
    }, delay);

    setTimeout(() => {
      agent.activeNotes.delete(answer);
      this.broadcastAll(JSON.stringify({
        type: 'note_off', peerId: agent.peer.peerId, pitch: answer, beatTime: 0, velocity: 0, timestamp: Date.now(),
      }));
    }, delay + beatMs * 0.25);
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
    agent.motif = motifFrom(notes);
    agent.barsSinceRest = notes.length === 0 ? 0 : agent.barsSinceRest + 1;
    agent.recentBars.push(notes.length > 0);
    agent.recentBars = agent.recentBars.slice(-4);

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

  /**
   * Address notes to absolute slots on the room's grid, so a late scheduler writes no phase error.
   * Shared by the lead agent and the rhythm section: one scheduler, one clock, no second copy to rot.
   */
  private emitBar(
    peer: Peer,
    notes: GeneratedNote[],
    bar: number,
    beatMs: number,
    state: { activeNotes: Set<string>; addNoteCount: () => void },
  ): void {
    const barStart = this.roomState.transportStartTime + bar * this.barMs();
    const latestUseful = -beatMs / 4; // a sixteenth late is no longer on its slot

    for (const note of notes) {
      const onDelay = barStart + note.beatTime * beatMs - Date.now();
      if (onDelay < latestUseful) continue;

      setTimeout(() => {
        const noteOn = JSON.stringify({
          type: 'note_on',
          peerId: peer.peerId,
          pitch: note.pitch,
          beatTime: note.beatTime,
          velocity: note.velocity,
          timestamp: Date.now(),
        });
        state.activeNotes.add(note.pitch);
        state.addNoteCount();
        this.broadcastAll(noteOn);
        this.pendingFlush.push(noteOn);
        // everyone in the room hears this through the same ring the humans come through
        this.recordEvent({ type: 'note_on', peerId: peer.peerId, pitch: note.pitch, beatTime: note.beatTime, velocity: note.velocity, timestamp: Date.now() });
      }, Math.max(0, onDelay));

      setTimeout(() => {
        const noteOff = JSON.stringify({
          type: 'note_off',
          peerId: peer.peerId,
          pitch: note.pitch,
          beatTime: note.beatTime + note.duration,
          velocity: 0,
          timestamp: Date.now(),
        });
        state.activeNotes.delete(note.pitch);
        this.broadcastAll(noteOff);
        this.pendingFlush.push(noteOff);
        this.recordEvent({ type: 'note_off', peerId: peer.peerId, pitch: note.pitch, beatTime: note.beatTime, velocity: 0, timestamp: Date.now() });
      }, Math.max(0, onDelay + note.duration * beatMs));
    }
  }

  private emitAgentBar(agent: InProcessAgent, notes: GeneratedNote[], bar: number, beatMs: number): void {
    agent.noteCount = 0;
    this.emitBar(agent.peer, notes, bar, beatMs, {
      activeNotes: agent.activeNotes,
      addNoteCount: () => { agent.noteCount++; },
    });
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

      // LISTEN. The bar is written against what the room is playing now, not against a note dump read
      // out of a buffer the persistence timer had already emptied.
      const others = this.othersRecent(agent.peer.peerId);
      const barMs = this.barMs();
      const beatMs = (60 / this.roomState.bpm) * 1000;
      const phrase = summarizePhrase(others, {
        barStartMs: this.roomState.transportStartTime + (this.barIndexOf(Date.now()) - 1) * barMs,
        barMs,
        beatMs,
      });
      const motifText = describeMotif(agent.motif);

      const jev = agent.tier === 'signed' ? jevConfigFromEnv(this.env) : null;
      const judged = jev
        ? await decideWithJev(jev, {
            key: this.roomState.key,
            bpm: this.roomState.bpm,
            style: agent.style,
            phrase: describePhrase(phrase),
            motif: motifText,
            activity: agent.recentBars.length
              ? `played ${agent.recentBars.filter(Boolean).length} of the last ${agent.recentBars.length} bars`
              : 'has not played yet',
            peers: this.peers.size + this.agents.size,
          } satisfies JevState)
        : null;

      // REST POLICY, IN CODE. A decision layer asked "should you sit this one out" will say yes as
      // soon as it has played a few bars, and measured over 20 live bars that made the agent silent
      // for 7 of them, which is not jamming, it is leaving. Jev keeps the JUDGEMENT (it may rest);
      // the room bounds the HABIT to one bar in five.
      const brief = judged && judged.role === 'rest' && agent.barsSinceRest < 5
        ? { ...judged, role: 'ornament' as const, play: true, density: 'sparse' as const }
        : judged;

      const ctx = {
        key: this.roomState.key,
        bpm: this.roomState.bpm,
        style: agent.style,
        recentNotes: others.filter(e => e.type === 'note_on').slice(-20)
          .map(e => ({ pitch: e.pitch, peerId: e.peerId, beatTime: e.beatTime })),
        currentBeat: 0,
        phrase: describePhrase(phrase),
        motif: motifText,
        heldNotes: [...new Set([...heldPitches, ...phrase.held])].slice(0, 8),
      };

      const result = await generateMeasureWithAi(this.env.AI, ctx, agent.model, brief, agent.tier);
      const repaired = repairMeasure(result.notes, {
        key: this.roomState.key,
        heldPitches,
        maxNotes: 10,
        // AN ANSWER THAT SHARES NOTHING IS NOT AN ANSWER: only enforced when the decision said so.
        answerPitches: brief?.role === 'answer' ? phrase.pitches : undefined,
      });

      // The bar this belongs to: the first one that is neither playing nor already queued.
      const queuedMax = agent.queue.reduce((max, q) => Math.max(max, q.bar), 0);
      const target = Math.max(this.barIndexOf(Date.now()) + 1, queuedMax + 1);
      agent.queue.push({
        bar: target,
        notes: repaired.notes,
        meta: {
          ...result.meta,
          noteCount: repaired.notes.length,
          plan: repaired.notes.slice(0, 6).map(n => `${n.pitch}@${n.beatTime}`).join(' ') || '(rest)',
        },
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
    const layerPeers = Array.from(this.layers.values()).map(l => l.peer);
    return [...wsPeers, ...agentPeers, ...layerPeers];
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
