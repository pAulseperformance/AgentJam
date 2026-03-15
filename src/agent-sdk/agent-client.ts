import type {
  NoteEvent,
  ServerMessage,
} from '@/shared/protocol';
import {
  type AgentContext,
  type AgentNoteRecord,
  type AgentPeer,
  createAgentContext,
  transition,
} from './agent-state';

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000] as const;

export interface AgentClientOptions {
  /** WebSocket URL: wss://host/api/room/{roomId}/ws */
  wsUrl: string;
  /** Display name for the agent peer */
  name: string;
  /** Instrument label */
  instrument?: string;
  /** Called when the agent should generate notes for the next measure */
  onMeasureReady?: (ctx: AgentContext) => void;
  /** Called on every incoming note event from other peers */
  onNoteEvent?: (event: NoteEvent) => void;
  /** Called on state transitions */
  onStateChange?: (state: AgentContext['state']) => void;
}

/**
 * JamRoomAgentClient — TAS-96 + TAS-101
 *
 * Headless WebSocket client for AI agents. Implements the same protocol
 * as browser clients but without React, Tone.js, or any DOM dependencies.
 *
 * - Connects to JamRoom DO via WebSocket
 * - Tracks room state (BPM, key, peers)
 * - Collects note events into a rolling buffer
 * - Triggers measure callbacks for LLM generation
 * - Auto-reconnects with exponential backoff
 * - MIDI panic cleanup on disconnect
 */
export class JamRoomAgentClient {
  private ws: WebSocket | null = null;
  private ctx: AgentContext;
  private options: AgentClientOptions;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private measureTimer: ReturnType<typeof setInterval> | null = null;
  private activeNotes: Set<string> = new Set();

  constructor(options: AgentClientOptions) {
    this.options = options;
    this.ctx = createAgentContext();
  }

  /** Get current agent context (read-only snapshot) */
  getContext(): Readonly<AgentContext> {
    return this.ctx;
  }

  /** Connect to the jam room */
  connect(): void {
    if (this.ctx.state !== 'idle') {
      console.warn('[AgentClient] Already connected or connecting');
      return;
    }

    transition(this.ctx, 'connecting');
    this.options.onStateChange?.('connecting');

    try {
      this.ws = new WebSocket(this.options.wsUrl);
      this.setupHandlers();
    } catch (err) {
      console.error('[AgentClient] WebSocket creation failed:', err);
      transition(this.ctx, 'idle');
      this.options.onStateChange?.('idle');
      this.scheduleReconnect();
    }
  }

  /** Disconnect gracefully */
  disconnect(): void {
    this.cleanup();
    transition(this.ctx, 'idle');
    this.options.onStateChange?.('idle');
  }

  /** Send a note event to the room */
  sendNoteEvent(event: NoteEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify(event));

    // Track active notes for cleanup
    if (event.type === 'note_on') {
      this.activeNotes.add(event.pitch);
    } else {
      this.activeNotes.delete(event.pitch);
    }
  }

  /** Send a raw message string */
  sendRaw(message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(message);
  }

  // ── WebSocket Handlers ──────────────────────────────────────────────

  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      transition(this.ctx, 'connected');
      this.options.onStateChange?.('connected');

      // Send join message
      this.ws!.send(JSON.stringify({
        type: 'join_room',
        name: this.options.name,
        kind: 'agent',
        instrument: this.options.instrument ?? 'PolySynth',
      }));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;

      // Hot path: note events → buffer + callback
      if (event.data.includes('"type":"note_o')) {
        try {
          const noteEvent = JSON.parse(event.data) as NoteEvent;
          this.pushNoteToBuffer(noteEvent);
          this.options.onNoteEvent?.(noteEvent);
        } catch { /* malformed */ }
        return;
      }

      // Cold path: parse + state update
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        console.warn('[AgentClient] Failed to parse message');
      }
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_state':
        this.ctx.transport = {
          bpm: msg.roomState.bpm,
          key: msg.roomState.key,
          transportStartTime: msg.roomState.transportStartTime,
        };
        this.ctx.peers.clear();
        for (const peer of msg.peers) {
          this.ctx.peers.set(peer.peerId, peer as AgentPeer);
        }

        // Start listening + measure timer
        if (this.ctx.state === 'connected') {
          transition(this.ctx, 'listening');
          this.options.onStateChange?.('listening');
          this.startMeasureTimer();
        }
        break;

      case 'peer_joined':
        this.ctx.peers.set(msg.peer.peerId, msg.peer as AgentPeer);
        break;

      case 'peer_left':
        this.ctx.peers.delete(msg.peerId);
        break;

      case 'clock_sync_pong': {
        // SNTP offset calculation (same as browser client)
        const t3 = performance.now();
        // @ts-expect-error -- t0 is stored on the context
        const t0 = this.ctx._pendingT0 as number | undefined;
        if (t0 !== undefined) {
          const rtt = (t3 - t0) - (msg.t2 - msg.t1);
          if (rtt < 500) {
            this.ctx.clockOffset = ((msg.t1 - t0) + (msg.t2 - t3)) / 2;
          }
        }
        break;
      }

      case 'error':
        console.warn('[AgentClient] Server error:', msg.message);
        break;
    }
  }

  // ── Measure Timer ───────────────────────────────────────────────────

  private startMeasureTimer(): void {
    if (this.measureTimer) clearInterval(this.measureTimer);

    // Calculate measure duration from BPM (4 beats per measure)
    const measureMs = () => (60 / this.ctx.transport.bpm) * 4 * 1000;

    this.measureTimer = setInterval(() => {
      this.ctx.measureCount++;

      if (this.ctx.state === 'listening') {
        this.options.onMeasureReady?.(this.ctx);
      }
    }, measureMs());
  }

  // ── Note Buffer ─────────────────────────────────────────────────────

  private pushNoteToBuffer(event: NoteEvent): void {
    const record: AgentNoteRecord = {
      peerId: event.peerId,
      pitch: event.pitch,
      beatTime: event.beatTime,
      velocity: event.velocity,
      type: event.type,
      timestamp: Date.now(),
    };

    this.ctx.noteBuffer.push(record);

    // Keep buffer bounded (last 128 events)
    if (this.ctx.noteBuffer.length > 128) {
      this.ctx.noteBuffer = this.ctx.noteBuffer.slice(-128);
    }
  }

  // ── SNTP Clock Sync ─────────────────────────────────────────────────

  /** Send a clock sync ping — call periodically for drift correction */
  sendClockPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.ctx.peerId) return;

    // @ts-expect-error -- storing on context for simplicity
    this.ctx._pendingT0 = performance.now();

    this.ws.send(JSON.stringify({
      type: 'clock_sync_ping',
      t0: performance.now(),
      peerId: this.ctx.peerId,
    }));
  }

  // ── Lifecycle & Cleanup (TAS-101) ───────────────────────────────────

  private handleDisconnect(): void {
    this.cleanup();
    transition(this.ctx, 'idle');
    this.options.onStateChange?.('idle');
    this.scheduleReconnect();
  }

  private cleanup(): void {
    if (this.measureTimer) {
      clearInterval(this.measureTimer);
      this.measureTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.activeNotes.clear();
    this.ctx.noteBuffer = [];
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
    ] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1]!;

    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.ctx = createAgentContext();
      this.connect();
    }, delay);
  }
}
