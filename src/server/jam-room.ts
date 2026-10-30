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
  midiOf,
  noteNameFromMidi,
  scalePitchClasses,
  type AgentStyle,
  type GeneratedNote,
} from '@/shared/music';
import { repairMeasure } from './measure-repair';
import { summarizePhrase, motifFrom, describePhrase, describeMotif, type Motif, type NoteRecord } from './listener';
import { melodyPlan, completeMelody, shapeLine, restateHook, applyContourRules, cadenceLine } from './melody';
import { drumBar, bassBar, countInBar } from './groove';
import {
  generateMeasureWithAi,
  AI_BUDGET_MS,
  FREE_MODEL,
  SIGNED_MODEL,
  isFreeModel,
  isKnownModel,
  type AiCallMeta,
  type Tier,
} from './llm-planner';
import {
  prunePast, keepNewest, takeForBar, renderBudget, renderStride, RENDER_COST_ASSUMED_MS,
  RENDER_TAIL_ASSUMED_MS, cellsForBar,
  barDelayMs, barMsFor, barElapsedEnough, firstReachableBar, nextRenderTail, DEFAULT_BAR_MS,
  MIN_BPM, MAX_BPM,
} from './bar-queue';
import { reactionCells, type ReactionBar } from './reaction';
import { decideWithJev, jevConfigFromEnv, type JevState } from './jev';

/** Set by the Worker entry on the upgrade request, computed from the door's answer. */
const TIER_HEADER = 'x-jam-tier';

/**
 * HOW LONG THE ROOM WILL WAIT FOR THE MODEL TO LOAD BEFORE WRITING BARS ANYWAY.
 *
 * The load is not a bar. Measured 2026-10-31 on a fresh room at 160 BPM, the agent's first model
 * call died on `AI call exceeded 1359ms` while every later call of the same run took 515-1519 ms,
 * which is the load being paid out of a bar's budget. Eight seconds outlasts a load that already
 * beat a 1359 ms budget and is short enough that a stuck request cannot hold the room past its
 * fallback.
 */
const WARM_BUDGET_MS = 8000;

/**
 * THE SMALLEST ASK THAT STILL LOADS THE MODEL. A warm call has no bar to fill, no phrase to answer
 * and no notes to write, so it must not send a measure prompt: the point is a loaded route, and a
 * four-token answer is the cheapest way to get one.
 */
const WARM_PROMPT = 'Reply with the single word OK.';
const WARM_MAX_TOKENS = 4;

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
   * WHAT A RENDER COSTS THIS AGENT, smoothed: Jev plus the model. The stride below is derived from it,
   * so a room whose calls are fast keeps playing every bar and a slow one writes less often.
   */
  renderCostMs: number;
  /** The same cost as a decaying maximum: the stride needs the tail, not the average. */
  renderTailMs: number;
  /**
   * THE BAR QUEUE, two deep. Bars are rendered AHEAD of the bar playing and published on the bar line,
   * so the model's latency never reaches the grid. Two slots matter: one render that overruns its bar
   * (measured tails of 2-3s on llama-3.2-3b) would otherwise leave a random pattern bar between two
   * model bars, which is the incoherence a listener hears immediately. An entry whose bar has already
   * started is dropped, never played late.
   */
  queue: Array<{
    bar: number;
    notes: GeneratedNote[];
    meta: AiCallMeta | null;
    /** when the render BEGAN: the moment after which nothing it heard could have been played */
    sawUpTo: number;
  }>;
  /** fires on the next bar boundary of the ROOM's transport, not on a timer started at spawn */
  barTimer: ReturnType<typeof setTimeout> | null;
  /**
   * When this agent last announced a bar, as server ms. A bar line cannot arrive twice inside half a
   * bar, so a second arrival is not a bar line whatever armed it: it is a loop, and publishing it
   * again is what filled the 2026-10-30 16:39 recording with 4,960 debug records in 2.6 seconds.
   */
  lastPublishedAt: number;
  /** the last four bars: true where it sounded, so it can notice it is over-playing */
  recentBars: boolean[];
  /** bars played since the last rest, so the rest policy below can bound them */
  barsSinceRest: number;
  /** comping budget: at most two reactive echoes in a bar, and which bar they belong to */
  echoesThisBar: number;
  lastEchoBar: number;
  /**
   * THE MID-BAR REFRESH. The boundary render for bar N+1 happens at the START of bar N, so it can
   * only hear up to bar N-1: measured, that made a reply answer a phrase two bars old, and a loud
   * phrase and a quiet one got the same response. This timer re-renders the queued bar partway
   * through the bar it belongs to, when something new has been played, and swaps the result in only
   * if it comes back from the model in time.
   */
  /** one mid-bar refresh per bar, so a busy human cannot turn into a render loop */
  refreshesThisBar: number;
  /**
   * ITS OWN LAST STATEMENT. A partner keeps an idea going; a generator starts over every bar. The
   * motif is what the decision layer may restate or vary, and what the model is told to keep.
   */
  motif: Motif | null;
  /** the bar this agent's phrase began at, so the arc is measured from ITS start, not the room's bar 0 */
  phraseStartBar: number;
  /** the phrase's hook, kept so the restate bar can bring it back with one change (Yin-Yang's "vary") */
  hook: GeneratedNote[] | null;
  /** the register the last decision asked for, so a fallback bar lands in the same band */
  lastRegister: 'low' | 'mid' | 'high';
  /** the last bar index this agent published, so one bar cannot be announced twice */
  lastBarIndex: number;
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
  /** the last moment anyone but an agent played, which is what makes a queued bar stale */
  private lastHumanAt = 0;
  /**
   * THE WARM CALL, ONE PER ROOM, started when the room opens and awaited by every render before its
   * own bar budget begins. It holds no notes and is never published: what it buys is a loaded model,
   * not a bar. See `warmTheModel`.
   */
  private modelWarm: Promise<void> | null = null;

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

    // WARM THE MODEL THE MOMENT THE ROOM OPENS, so the load is paid in the gap between a listener
    // arriving and an agent being asked for a bar, not inside the first bar's budget. Once per room:
    // a second listener buys no second call (`warmTheModel` refuses one), and a room nobody spawns
    // in pays four tokens for nothing, which is cheaper than a first bar that cannot answer.
    void this.warmTheModel(this.tierOf(ws));

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

  private handleBpmChange(ws: WebSocket, bpm: number): void {
    // A TEMPO THE GRID CANNOT USE IS REFUSED HERE TOO. The inbound schema already bounds it to 20..300,
    // but a bar length of NaN or Infinity makes `setTimeout` fire at once and loop, so the room does not
    // rely on a validator that lives in the client.
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
      this.sendError(ws, `tempo refused: ${String(bpm)} is outside ${MIN_BPM} to ${MAX_BPM} BPM`);
      return;
    }
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
    // A BAR RENDERED IN THE OLD KEY MAY NOT PLAY UNDER THE NEW ONE. The tempo path already drops the
    // queue for the same reason; the hook goes with it, because a restate copies its pitches verbatim.
    for (const agent of this.agents.values()) {
      agent.queue = [];
      agent.hook = null;
    }
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

  /**
   * WARM THE MODEL BEFORE THE FIRST BAR, exactly once per room.
   *
   * The model's first call in a fresh isolate pays that model's load, and a render that starts while
   * the load is still in flight spends its own bar budget on it: measured 2026-10-31 at 160 BPM on a
   * fresh room, the first model call died on `AI call exceeded 1359ms` at t=3,745 ms while every
   * later call of the same agent took 515-1519 ms and landed. The room cannot make the load cheaper,
   * so it pays it before anyone needs a bar and throws the answer away.
   *
   * One call site, one promise: the room's opening starts it, a second listener or a third agent
   * waits on the same one, and a room whose binding is missing simply has nothing to warm.
   */
  private warmTheModel(tier: Tier): Promise<void> {
    if (this.modelWarm) return this.modelWarm;
    const ai = this.env.AI;
    // NO BINDING IS NOT A FAILURE: the render path already falls back to the pattern generator when
    // there is no AI binding. Resolving here keeps the promise settled for every caller.
    this.modelWarm = ai
      ? this.runWarmCall(ai, tier === 'signed' ? SIGNED_MODEL : FREE_MODEL)
      : Promise.resolve();
    return this.modelWarm;
  }

  /**
   * The call itself, bounded and never rejecting. The timer is cleared on the way out, so a room
   * that answered in 700 ms does not carry an eight-second timer it never used.
   */
  private async runWarmCall(ai: NonNullable<Env['AI']>, model: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        ai.run(model, {
          messages: [{ role: 'user', content: WARM_PROMPT }],
          max_tokens: WARM_MAX_TOKENS,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`warm call exceeded ${WARM_BUDGET_MS}ms`)),
            WARM_BUDGET_MS,
          );
        }),
      ]);
    } catch {
      // A ROOM THAT COULD NOT WARM STILL PLAYS. The render path's own fallback covers the bar, and
      // the render is released either way: the wait below is never left pending.
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

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
      renderCostMs: RENDER_COST_ASSUMED_MS,
      renderTailMs: RENDER_TAIL_ASSUMED_MS,
      // Nothing is queued at spawn: the first boundary plays a pattern bar (never silence) while two
      // model renders fill the queue behind it.
      queue: [],
      barTimer: null,
      lastPublishedAt: 0,
      recentBars: [],
      barsSinceRest: 99,
      echoesThisBar: 0,
      lastEchoBar: -1,
      refreshesThisBar: 0,
      motif: null,
      // THE PHRASE STARTS WHEN THE AGENT DOES. Measured: the arc used the ROOM's bar number, so the
      // cadence rotated with the room instead of landing at the end of the agent's own phrase.
      phraseStartBar: this.barIndexOf(Date.now()) + 1,
      hook: null,
      lastRegister: 'mid',
      lastBarIndex: -1,
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
    // A DRUM HIT IS NOT A PERSON AT THE KEYBOARD. The backing section set this on every bar, so the
    // "someone is playing, do not lead" rule fired continuously in every room that had a drummer on.
    if (event.type === 'note_on' && this.isPlayerPeer(event.peerId)) {
      const isAgent = Array.from(this.agents.values()).some(a => a.peer.peerId === event.peerId);
      if (!isAgent) this.lastHumanAt = Date.now();
    }
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
    // THE DRUMMER IS NOT A PLAYER TO ANSWER. Left in, its fixed figure was summarized as "they are
    // playing: ... strong beats: C2, A5" and as a note someone is holding, so an agent was told not to
    // play A5 because a hi-hat had it, and was asked to answer a kick drum.
    return this.noteRing.filter(n =>
      n.peerId !== agentPeerId && n.timestamp >= since && this.isPlayerPeer(n.peerId));
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
      // The client builds a drum KIT for this name: a kick, a snare and a hat are three voices
      instrument: role === 'drummer' ? 'DrumKit' : 'PolySynth',
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
    // The rhythm section arms on the same grid and carries the same hazard, so it gets the same rule.
    if (layer.barTimer !== null) clearTimeout(layer.barTimer);
    const wait = barDelayMs(this.roomState.transportStartTime, this.roomState.bpm, Date.now())
      ?? this.barMs();
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
    // A STORED TEMPO CAN BE CORRUPT even though the door validates every change, because the state is
    // restored from storage at construction. Every use below divides by this, so it cannot be NaN.
    return barMsFor(this.roomState.bpm) ?? DEFAULT_BAR_MS;
  }

  /**
   * How many bars this agent writes one bar of music, derived from what its own renders cost rather
   * than from a tempo table. A 240 BPM room with fast calls still plays every bar; a 160 BPM room with
   * slow ones halves its phrase rate instead of writing bars that arrive after their own line.
   */
  private strideFor(agent: InProcessAgent): number {
    // The TAIL decides, not the mean. Measured A/B at 160 BPM on live traffic, 45 s per arm, three
    // agents and backing on: tail versus mean published the same 38 model bars with the same 2
    // fallbacks, so the tail costs nothing and reacts to a single slow call instead of waiting for the
    // average to catch up. The switch that ran that experiment is gone.
    return renderStride(Math.max(agent.renderCostMs, agent.renderTailMs), this.barMs());
  }

  /**
   * Whether a peer is a PLAYER: a human at a keyboard or another model agent. The room's drummer and
   * bass are not: they count and they accompany, so their notes must not enter the phrase an agent
   * listens to, and a drum hit must not read as a person at the keyboard.
   */
  private isPlayerPeer(peerId: string): boolean {
    for (const agent of this.agents.values()) if (agent.peer.peerId === peerId) return false;
    for (const layer of this.layers.values()) if (layer.peer.peerId === peerId) return false;
    return true;
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

  /**
   * RE-RENDER THE QUEUED BAR WITH FRESH EARS, ONCE, IF THERE IS TIME.
   *
   * Called after every render rather than on a fixed timer: measured, a fixed 55% timer fired while the
   * bar-line render was still running and was skipped as busy on most bars, so the reply kept answering
   * a phrase two bars old. Chaining it on the previous render's completion means it only runs when the
   * agent is free and there is still room before the bar line.
   *
   * A refresh replaces the same bar's notes only if the model answers in time and the answer is a model
   * bar; a fallback never displaces real music.
   */
  private maybeRefreshHead(agent: InProcessAgent): void {
    if (agent.busy) return;
    if (agent.refreshesThisBar >= 1) return;

    const head = agent.queue[0];
    if (!head) return;
    // The next bar this agent intends to write, which at a high tempo is more than one bar away.
    if (head.bar !== this.barIndexOf(Date.now()) + this.strideFor(agent)) return;

    // STALENESS IS WHEN THE RENDER BEGAN, not when it finished: a bar written at the bar line finished
    // a second later and still heard nothing of the bar it plays in.
    if (head.sawUpTo >= this.lastHumanAt) return;

    // A render needs about 0.8s at 120 BPM (measured 0.6 to 1.1s); without that room, a refresh would
    // only arrive after its own bar started.
    if (this.nextBarStart() - Date.now() < 650) return;

    agent.refreshesThisBar++;
    // WITHOUT THE JEV CALL. A refresh that paid for a decision as well measured 1.2s against a 2s bar
    // and never landed; reusing the brief the bar was already written with halves it to about 0.7s,
    // which fits in the room a finished render leaves.
    void this.renderAgentBar(agent, head.bar, head.meta?.brief ?? null);
  }

  private armAgentBar(agent: InProcessAgent): void {
    // ONE TIMER PER AGENT, AND NEVER A ZERO WAIT. Arming without clearing is how a tempo change can
    // double the bar line, and a wait of 0 is self-sustaining: the callback re-arms itself, so firing
    // once a millisecond never stops. `barDelayMs` refuses an unusable grid instead of returning NaN,
    // which `setTimeout` reads as 0.
    if (agent.barTimer !== null) clearTimeout(agent.barTimer);
    const wait = barDelayMs(this.roomState.transportStartTime, this.roomState.bpm, Date.now())
      ?? this.barMs();
    agent.barTimer = setTimeout(() => this.onAgentBar(agent), wait);
  }

  /** One bar boundary: publish the bar that was prepared, then render the next one. */
  private onAgentBar(agent: InProcessAgent): void {
    agent.barTimer = null;
    if (!this.agents.has(agent.peer.peerId)) return;

    const bar = this.barIndexOf(Date.now());
    const beatMs = (60 / this.roomState.bpm) * 1000;

    // ONE PUBLICATION PER BAR, AS AN INVARIANT RATHER THAN A HOPE. The cause of the 2026-10-30 loop is
    // still unproven, so the guard is on the clock: no agent may announce a bar sooner than half a bar
    // after the last one. A fire that trips this waits for the real next line instead of repeating.
    const publishedAt = Date.now();
    // THE BAR INDEX IS THE INVARIANT, because the clock is not. At a fractional bar length (140 BPM is
    // 1714.2857ms) a wait can land on the PREVIOUS index and the half-bar guard passes, so one bar is
    // announced twice and its fallback bar is addressed into the past (measured 2 of 25 waits).
    if (bar <= agent.lastBarIndex || !barElapsedEnough(agent.lastPublishedAt, publishedAt, this.barMs())) {
      this.armAgentBar(agent);
      return;
    }
    agent.lastBarIndex = bar;
    agent.lastPublishedAt = publishedAt;

    // PUBLISH. An entry queued for THIS bar plays; anything else is a bar the model missed, and the
    // pattern generator covers it rather than shifting a stale bar into the present. Entries for bars
    // that have gone are pruned HERE first, because keeping them is what locked the queue on the
    // 2026-10-30 recording: two dead entries held both slots and no render was attempted again.
    agent.queue = prunePast(agent.queue, bar);
    const claimed = takeForBar(agent.queue, bar);
    agent.queue = claimed.rest;
    const ready = claimed.ready;
    // A GAP BAR IS THE AGENT'S OWN SHORT CELLS, NOT THE GENERATOR'S LINE. Above a stride of one this
    // agent writes a full bar every stride-th bar, and the bars between them used to be the pattern
    // generator's random walk: measured at 200 BPM, 37 of 72 bar records were music the agent had not
    // said. A gap bar now carries two to four cells quoting its own motif, in key, in its register.
    const stride = this.strideFor(agent);
    const reaction = ready === null && stride > 1 ? this.reactionFor(agent, bar) : null;
    let notes: GeneratedNote[];
    if (ready) {
      notes = ready.notes;
    } else if (stride > 1) {
      // A GAP BAR IS THE AGENT'S CELLS OR NOTHING. It is never the generator: handing a gap bar back
      // to the random walk is exactly what this path exists to stop, so a gap with no cell is silence,
      // not a different bar of music played in the agent's name.
      notes = reaction?.notes ?? [];
    } else {
      // At a stride of one an empty bar is a bar the model missed, and the line builder covers it.
      notes = this.melodyBar(agent, bar);
    }

    // LAST LINE OF DEFENCE. Two agents render the same bar at the same moment, so each can see a plan
    // that the other has not queued yet and a collision slips through the repair. At the bar line the
    // other agent's bar is already sounding, so a shared slot is dropped here, where it is a fact.
    const sounded = this.soundedSlots(agent.peer.peerId, bar);
    if (sounded.size > 0) {
      notes = notes.filter(n => !sounded.has(`${n.pitch}@${n.beatTime}`.toLowerCase()));
    }
    this.markSoundedSlots(agent.peer.peerId, bar, notes);
    // WHY A PATTERN BAR, SAID OUT LOUD. A bar with no queued render at a stride of one is a bar the
    // model missed; above a stride of one that bar is the agent's cells, so the tempo note now rides
    // on the cell record below instead of on a bar the generator played.
    const meta = ready?.meta ?? (reaction
      ? this.cellMeta(agent, reaction, stride)
      : this.patternMeta(agent, notes, 'pattern bar, the queue was empty'));

    this.emitAgentBar(agent, notes, bar, beatMs);
    // A CELL BAR DOES NOT REPLACE THE AGENT'S IDEA. Its cells quote the motif, so overwriting the
    // motif with them would shrink the agent's material to its own echo, one gap bar at a time.
    if (reaction === null) agent.motif = motifFrom(notes);
    agent.barsSinceRest = notes.length === 0 ? 0 : agent.barsSinceRest + 1;
    agent.recentBars.push(notes.length > 0);
    agent.recentBars = agent.recentBars.slice(-4);

    this.broadcastAll(JSON.stringify({
      type: 'ai_debug',
      agentPeerId: agent.peer.peerId,
      agentName: agent.peer.name,
      // THE BAR, so a recorded session can place a decision. Without it every bar in an export was
      // only a millisecond offset, and two agents made them unreadable.
      bar,
      meta,
    }));

    // REFILL. Two slots means a slow render costs freshness, not the next bar's coherence. When a bar
    // is shorter than a render, one slot IS the cadence: a second would queue a bar the agent cannot
    // reach, and the queue would fill with exactly the entries the prune exists to remove.
    agent.refreshesThisBar = 0;
    const depth = stride > 1 ? 1 : 2;
    if (agent.queue.length < depth) void this.renderAgentBar(agent);
    else this.maybeRefreshHead(agent);

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
  /**
   * WHAT THE OTHER AGENTS HAVE ALREADY QUEUED for this bar. Their plan is written a bar ahead, so a
   * second agent can see what is coming and answer it instead of walking on top of it.
   */
  private otherAgentPlan(excludePeerId: string, bar: number): string[] {
    const slots: string[] = [];
    for (const other of this.agents.values()) {
      if (other.peer.peerId === excludePeerId) continue;
      const entry = other.queue.find(q => q.bar === bar);
      if (!entry) continue;
      for (const n of entry.notes) slots.push(`${n.pitch}@${n.beatTime}`);
    }
    return slots;
  }

  /**
   * ONE AGENT LEADS A BAR. Two agents both deciding to lead is two solos played over each other, which
   * is exactly what "they are not collaborating" sounds like. The turn rotates by bar over the agents
   * in spawn order, so a room of two agents has a call and an answer with nobody at the keyboard.
   */
  private coordinateRole(
    agent: InProcessAgent,
    bar: number,
    brief: AiCallMeta['brief'],
    hasHumanPhrase: boolean,
  ): AiCallMeta['brief'] {
    if (!brief) return brief;
    const peers = [...this.agents.values()].filter(a => a.peer.peerId !== agent.peer.peerId);

    // ALONE IN THE ROOM, THE AGENT IS THE LEAD. With no second agent and no human phrase, "ornament"
    // and "answer" describe a partner that is not there, and the agent played a two-note loop for it.
    if (peers.length === 0) {
      if (!hasHumanPhrase && brief.play !== false && brief.role !== 'lead') {
        return { ...brief, role: 'lead', density: brief.density === 'sparse' ? 'medium' : brief.density };
      }
      return brief;
    }

    const order = [...this.agents.keys()];
    const myTurn = order[bar % order.length] === agent.peer.peerId;
    // A HUMAN WHO JUST PLAYED IS THE LEAD. An agent that leads over them is not answering, it is talking
    // over the person the room is built for.
    const humanLeading = hasHumanPhrase
      && this.lastHumanAt > 0
      && Date.now() - this.lastHumanAt < this.barMs() * 2;

    if (brief.role === 'lead' && humanLeading) return { ...brief, role: 'answer' };

    // NOBODY BUT AGENTS ARE PLAYING: the turn holder takes the line. Alternating by bar means the room
    // keeps a conversation going with no one at the keyboard, which is the point of independent agents.
    if (myTurn) {
      if (brief.role === 'rest') return { ...brief, role: 'lead', play: true, density: 'sparse' };
      return { ...brief, role: 'lead' };
    }

    // NOT MY TURN: answer or ornament, never lead.
    if (brief.role === 'lead') return { ...brief, role: 'answer' };
    return brief;
  }

  /**
   * A BAR WITH NO MODEL ANSWER IS STILL MUSIC, NOT NOISE. The old fallback was `generateMeasure`, which
   * picks pitches at random across three octaves: measured live it produced `G3 B3 G5 C4 A4 D3 E5 C5 B5`
   * and it is what a listener hears when a render misses its bar. The line builder writes a stepwise
   * melody on the same arc instead, so a missed bar costs a model's flourish and not the tune.
   */
  private melodyBar(agent: InProcessAgent, bar: number): GeneratedNote[] {
    const barInPhrase = ((bar - agent.phraseStartBar) % 4 + 4) % 4;
    const plan = melodyPlan(barInPhrase, agent.style, agent.motif !== null);
    const register = this.registerRange(agent.lastRegister ?? 'mid');
    const built = completeMelody([], {
      plan,
      key: this.roomState.key,
      motif: agent.motif,
      register,
      maxNotes: 10,
    });
    // THE SAME RULES AS A MODEL BAR, including the repair: a fallback bar used to skip the unison drop,
    // the slot check and the register, and measured three C5s in a row and a bar at a flat velocity 80.
    const repaired = repairMeasure(built.notes, {
      key: this.roomState.key,
      heldPitches: this.heldByOthers(agent.peer.peerId),
      maxNotes: 10,
    });
    const conformed = applyContourRules(repaired.notes, { key: this.roomState.key, register });
    return shapeLine(conformed, { contour: plan.contour, density: 'medium' });
  }

  /**
   * The midi window a decision asked for. A melody that wanders from C3 to C6 is not a melody in a
   * register, it is a siren, so completion is held inside the band the decision named.
   */
  private registerRange(band: 'low' | 'mid' | 'high'): { low: number; high: number } {
    if (band === 'low') return { low: 40, high: 59 };
    if (band === 'high') return { low: 72, high: 88 };
    return { low: 55, high: 72 };
  }

  /** slots another agent has already sounded in this bar, keyed `pitch@beat` */
  private soundedSlots(excludePeerId: string, bar: number): Set<string> {
    const slots = new Set<string>();
    for (const other of this.agents.values()) {
      if (other.peer.peerId === excludePeerId) continue;
      const played = this.playedByBar.get(other.peer.peerId)?.get(bar);
      if (!played) continue;
      for (const slot of played) slots.add(slot);
    }
    return slots;
  }

  private markSoundedSlots(peerId: string, bar: number, notes: GeneratedNote[]): void {
    let byBar = this.playedByBar.get(peerId);
    if (!byBar) { byBar = new Map(); this.playedByBar.set(peerId, byBar); }
    const slots = new Set(notes.map(n => `${n.pitch}@${n.beatTime}`.toLowerCase()));
    byBar.set(bar, slots);
    // a bar is only interesting for two bars: keeping more would leak memory as the room ages
    for (const b of byBar.keys()) if (b < bar - 2) byBar.delete(b);
  }

  /** per agent, the slots it actually sounded per bar, so two agents cannot double a note on a beat */
  private playedByBar = new Map<string, Map<number, Set<string>>>();

  private async renderAgentBar(
    agent: InProcessAgent,
    targetBar?: number,
    /** reuse a decided brief instead of asking Jev again, so a refresh costs ONE call, not two */
    reuseBrief?: AiCallMeta['brief'],
  ): Promise<void> {
    if (agent.busy) return;
    agent.busy = true;

    try {
      // THE MODEL'S LOAD IS NOT PAID INSIDE A BAR. A render that starts while the model is still
      // loading spends its own budget on the load: measured 2026-10-31 at 160 BPM, a fresh room's
      // first model call died on `AI call exceeded 1359ms` while every later call took 515-1519 ms.
      // The room's warm call (handleJoin) is awaited HERE, before anything is measured, and
      // `sawUpTo` moves with it: what this bar can have heard is what was played after the wait.
      await this.modelWarm;
      const sawUpTo = Date.now();
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

      // THE BAR THIS RENDER IS FOR, and what the other agents have queued for it. Both are needed
      // BEFORE the decision, because a second agent has to decide against the first agent's plan.
      // THE TARGET MOVES OUT when one bar no longer holds a render: at 200 BPM a 1200 ms bar cannot
      // take 1.3 s of Jev plus model, so the agent's next statement is two bars out. Always strictly
      // ahead of anything already queued, so a bar that has gone can never be written twice.
      const stride = this.strideFor(agent);
      const queuedMax = agent.queue.reduce((max, q) => Math.max(max, q.bar), 0);
      let forBar = targetBar ?? Math.max(this.barIndexOf(Date.now()) + stride, queuedMax + stride);
      if (targetBar === undefined) {
        // AND NEVER AT A LINE IT CANNOT REACH: a spawning agent inherits the remainder of the current
        // bar, so its first render can be handed a third of a bar and fail on a cold start.
        forBar = firstReachableBar(
          this.roomState.transportStartTime,
          this.barMs(),
          forBar,
          Date.now(),
          agent.renderCostMs + 100,
        );
      }
      const peerPlan = this.otherAgentPlan(agent.peer.peerId, forBar);
      // WHERE THIS BAR SITS IN THE PHRASE: state, restate, develop, cadence. A melody needs a shape
      // across bars; a bar written with no idea where it sits is a gesture that happens to be in time.
      const barInPhrase = ((forBar - agent.phraseStartBar) % 4 + 4) % 4;
      const melody = melodyPlan(barInPhrase, agent.style, agent.motif !== null);

      const jev = agent.tier === 'signed' && reuseBrief === undefined ? jevConfigFromEnv(this.env) : null;
      const judged = reuseBrief !== undefined
        ? reuseBrief
        : jev
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
      // NO DECISION IS NOT NO IDEA. A public room has no Jev, and passing null here meant no arc,
      // no role and no completion: measured on a public session, sixteen bars of eight sixteenths at a
      // flat velocity 100, which is what a listener hears as a typewriter. The brief is code's job
      // when the judge is absent.
      const judgedOrCode: typeof judged = judged ?? {
        role: 'lead',
        relation: agent.motif ? 'vary' : 'new',
        density: 'medium',
        register: 'mid',
        play: true,
        latencyMs: 0,
      };

      const rested = judgedOrCode.role === 'rest' && agent.barsSinceRest < 5
        ? { ...judgedOrCode, role: 'ornament' as const, play: true, density: 'sparse' as const }
        : judgedOrCode;
      const brief = this.coordinateRole(agent, forBar, rested, phrase.count > 0);

      // THE TAIL-AWARE ASK'S NUMBERS. The tail is the worst of this agent's recent renders, which is
      // the stride's own reading; the window is ONE BAR, because an ask writes one bar of music. A
      // refresh offers no tail reading: it replaces a bar the queue already holds, and shrinking that
      // ask to a cell would swap a full line for two notes.
      const tailMs = Math.max(agent.renderCostMs, agent.renderTailMs);

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
        peerPlan: peerPlan.slice(0, 6).join(' ') || undefined,
        melody: melody.instruction,
        stride,
        tailMs: targetBar === undefined ? tailMs : undefined,
        windowMs: this.barMs(),
        cellSlot: this.cellAskSlot(agent, forBar),
      };

      // THE MODEL'S BUDGET COMES FROM THE ROOM, NOT FROM A CONSTANT. 2500ms against a 1500ms bar at
      // 160 BPM is over by a whole bar, so a hung call guaranteed the miss that started the cascade.
      // The time left before the bar line is the only honest deadline, less a margin for the write.
      // The deadline is the start of the bar being written for, which at a high tempo is more than
      // one bar away. Measuring to the NEXT bar line would cancel a call that has the time to finish.
      const deadlineMs = this.roomState.transportStartTime + forBar * this.barMs();
      const budgetMs = renderBudget(deadlineMs - Date.now(), AI_BUDGET_MS);
      const result = await generateMeasureWithAi(
        this.env.AI, ctx, agent.model, brief, agent.tier, budgetMs,
      );
      // WHAT A RENDER ACTUALLY COSTS, smoothed per agent. This is the number the stride comes from, so
      // the tempo policy is measured rather than guessed, and it survives a model that gets slower.
      // Weighted hard towards history: one slow call must not halve a 160 BPM room's phrase rate, and
      // the prune now covers the occasional overrun that made a single outlier expensive to ignore.
      const costMs = (brief?.latencyMs ?? 0) + result.meta.latencyMs;
      agent.renderCostMs = agent.renderCostMs * 0.85 + costMs * 0.15;
      agent.renderTailMs = nextRenderTail(agent.renderTailMs, costMs);

      // THE ANSWER TO A CELL ASK IS ALREADY ITS BAR: two notes on the slot the room named. Repairing
      // it, completing it along the phrase arc or contouring it would turn the cell back into the
      // measure that was not asked for.
      const cellAsk = result.meta.ask === 'cell';
      let finalNotes = result.notes;
      const register = this.registerRange(brief?.register ?? 'mid');
      agent.lastRegister = brief?.register ?? 'mid';

      if (!cellAsk) {
        const repaired = repairMeasure(result.notes, {
          key: this.roomState.key,
          heldPitches,
          maxNotes: 10,
          // AN ANSWER THAT SHARES NOTHING IS NOT AN ANSWER: only enforced when the decision said so.
          answerPitches: brief?.role === 'answer' ? phrase.pitches : undefined,
          // TWO of their pitch classes, not one: measured, a one-note borrow reads as its own material.
          answerShare: brief?.role === 'answer' ? 2 : undefined,
          // PLAY AT THE ROOM'S LEVEL: a shout answered by a whisper is not an answer either.
          targetMeanVelocity: phrase.count > 0 ? phrase.meanVelocity : undefined,
          // NOT THE SAME SLOT AS THE OTHER AGENT: their bar is already queued and about to sound.
          avoidSlots: peerPlan,
        });
        finalNotes = repaired.notes;

        // A LEAD BAR IS A MELODY, NOT A GESTURE. The model writes what it can and this is what happens
        // when what it writes is a triad: the line is completed in key, along the arc, on the grid.
        if (brief?.role === 'lead' && melody.position === 'cadence') {
          // THE PHRASE LANDS: two notes, the last on the tonic, approached by step, held longer
          finalNotes = cadenceLine({
            key: this.roomState.key,
            register,
            fromMidi: finalNotes.length ? midiOf(finalNotes.at(-1)!.pitch) ?? undefined : undefined,
          });
        } else if (brief?.role === 'lead' && melody.position === 'restate' && agent.hook?.length) {
          // THE HOOK COMES BACK. One change, chosen by the bar, never a new line (arXiv 2501.17759)
          finalNotes = restateHook(agent.hook, { key: this.roomState.key, register, bar: forBar });
        } else if (brief?.role === 'lead') {
          const completed = completeMelody(finalNotes, {
            plan: melody,
            key: this.roomState.key,
            motif: agent.motif,
            register,
            maxNotes: 10,
          });
          if (completed.completed) {
            finalNotes = completed.notes;
            result.meta.completed = completed.added;
          }
        }

        // THE CONTOUR RULES, from species counterpoint: mostly steps, a leap answered by a step the other
        // way, never two leaps in the same direction, never the same pitch twice. Measured before, leaps
        // were as likely as steps and one bar repeated C5 four times (four C5s came from clamping).
        finalNotes = applyContourRules(finalNotes, { key: this.roomState.key, register });

        // AND IT BREATHES. Dynamics are code's, not the model's: a 3B model writes one velocity for the
        // whole bar, and a flat eight-sixteenth run is heard as a typewriter, not as a player.
        finalNotes = shapeLine(finalNotes, {
          contour: melody.contour,
          density: brief?.density ?? 'medium',
          meanVelocity: phrase.count > 0 ? phrase.meanVelocity : undefined,
        });

        // THE FIRST BAR OF A PHRASE IS THE HOOK. Kept exactly as it will be heard, because the restate
        // bar returns this, not a re-render of it.
        if (brief?.role === 'lead' && melody.position === 'state' && finalNotes.length >= 3) {
          agent.hook = finalNotes.map(n => ({ ...n }));
        }
      }

      // The bar this belongs to, worked out before the decision so the decision could see it.
      const target = forBar;

      // A REFRESH THAT CAME BACK AS A FALLBACK DOES NOT GET TO REPLACE A MODEL BAR: the old entry is
      // stale but it is real music, and the repairer's fallback is only a bar. A CELL NEVER REPLACES A
      // BAR EITHER: the queue already holds a full line for this slot, and two notes are less than it.
      const replacing = agent.queue.some(q => q.bar === target);
      if (replacing && (result.meta.source !== 'llm' || cellAsk)) return;

      if (replacing) agent.queue = agent.queue.filter(q => q.bar !== target);
      agent.queue.push({
        bar: target,
        sawUpTo,
        notes: finalNotes,
        meta: {
          ...result.meta,
          refreshed: replacing,
          noteCount: finalNotes.length,
          plan: finalNotes.slice(0, 6).map(n => `${n.pitch}@${n.beatTime}`).join(' ') || '(rest)',
        },
      });
      // KEEP THE NEWEST, not the lowest. Sorting ascending and slicing kept the two OLDEST entries,
      // which on a late render were bars that had already passed, and threw away the bar just written.
      agent.queue = keepNewest(agent.queue, 2);
    } finally {
      agent.busy = false;
      // CHAIN: a render that just finished is the only moment a second one can start without a clash.
      this.maybeRefreshHead(agent);
    }
  }

  /**
   * THE GAP BAR'S VOICE. At a stride above one the agent writes every stride-th bar, so the bar in
   * between belongs to it but cannot hold a render. It holds its own short cells instead: the pitches
   * of its last statement, moved into the register its decision asked for, in the room's key, on the
   * bar's eighth grid. No model call, no generator, and deterministic in the bar number.
   */
  private reactionFor(agent: InProcessAgent, bar: number): ReactionBar {
    return reactionCells({
      motif: agent.motif,
      hook: agent.hook,
      key: this.roomState.key,
      style: agent.style,
      bar,
      register: this.registerRange(agent.lastRegister ?? 'mid'),
      cells: cellsForBar(this.barMs()),
      // A GAP BAR PUBLISHED LATE PLAYS WHAT IS STILL AHEAD OF IT. Measured post-deploy at 200 BPM:
      // 2 of 37 cell bars were silent because every cell slot was already past when the bar published.
      fromBeat: this.beatIntoBar(bar),
      voice: this.voiceOf(agent),
    });
  }

  /**
   * WHICH AGENT THIS IS, as a small number: its position in the room's spawn order. Two agents with
   * nothing of their own yet would otherwise seed the same figure and lose their first gap bar to each
   * other's collision rule (measured: 2 of 3 agents at 200 BPM).
   */
  private voiceOf(agent: InProcessAgent): number {
    const order = [...this.agents.keys()];
    const at = order.indexOf(agent.peer.peerId);
    return at < 0 ? 0 : at;
  }

  /**
   * THE SLOT A CELL ASK NAMES. The bar's eighth grid, rotated by (bar, voice) so two agents paced into
   * the same bar do not answer on the same beat. The downbeat is left to the room's own bars and to the
   * count-in, so a cell never lands where the bar's own line begins.
   */
  private cellAskSlot(agent: InProcessAgent, bar: number): number {
    const slots = [1.5, 2, 2.5, 3];
    const at = (((bar + this.voiceOf(agent)) % slots.length) + slots.length) % slots.length;
    return slots[at] ?? 2;
  }

  /** How far into bar `bar` the room's clock is, in beats. 0 when the tempo cannot describe one. */
  private beatIntoBar(bar: number): number {
    const beatMs = (60 / this.roomState.bpm) * 1000;
    if (!(beatMs > 0) || !Number.isFinite(beatMs)) return 0;
    const barStart = this.roomState.transportStartTime + bar * this.barMs();
    const elapsed = Date.now() - barStart;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return elapsed / beatMs;
  }

  /**
   * THE RECORD FOR A CELL BAR, under its own name. `pattern` would be a misreading of the recording:
   * the generator did not write this bar, and a session's `pattern` count is exactly the number this
   * card exists to bring down. The tempo note stays on the line, so a recorded session still says why
   * the agent is writing every second bar instead of every bar.
   */
  private cellMeta(agent: InProcessAgent, reaction: ReactionBar, stride: number): AiCallMeta {
    return {
      source: 'cell', tier: agent.tier, model: agent.model, decider: 'none', brief: null,
      prompt: '(cell bar)',
      response: `${reaction.describe}; this agent writes every ${stride} bars at ${this.roomState.bpm} BPM`,
      noteCount: reaction.notes.length, latencyMs: 0,
    };
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
