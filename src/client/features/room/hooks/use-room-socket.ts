import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  Peer,
  RoomState,
  ServerMessage,
  NoteEvent,
  MetricsSnapshot,
} from '@/shared/protocol';
import { recordMessage, noteRoomState, beginSession } from '../lib/session-recorder';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface UseRoomSocketOptions {
  roomId: string;
  playerName: string;
  playerKind: 'human' | 'agent';
  instrument?: string;

  /**
   * Called on EVERY raw note event received — bypasses React state entirely.
   * This is the v5 "React Thread Isolation" pattern: route note events
   * directly to the AudioEngine without triggering React re-renders.
   */
  onNoteEvent?: (event: NoteEvent) => void;
}

interface UseRoomSocketReturn {
  status: ConnectionStatus;
  roomState: RoomState | null;
  peers: Peer[];
  sendMessage: (message: string) => void;
  sendNoteEvent: (event: NoteEvent) => void;
  disconnect: () => void;
  /** TAS-106: Latest metrics snapshot from server */
  metrics: MetricsSnapshot | null;
  /** TAS-106: Client-measured WebSocket RTT in ms */
  wsRtt: number | null;
  /** TAS-106: Client SNTP clock offset in ms */
  clockOffset: number | null;
  /** AI debug entries — last prompt/response/metadata per agent */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic debug payload from server
  aiDebugEntries: any[];
  /** Each agent's style and seat, kept from agent_spawned so the panel's per-agent controls can show them */
  agentParts: Map<string, { style: string; seat: string }>;
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000] as const;

/**
 * Manages the WebSocket connection to a JamRoom Durable Object.
 *
 * v5 patterns implemented:
 * - Note events bypass React state (routed via onNoteEvent callback)
 * - Automatic reconnection with exponential backoff
 * - Room state + peer list managed in React state (infrequent updates)
 *
 * Phase 3 additions:
 * - Metrics snapshot tracking (TAS-106)
 * - Event backfill handling on reconnect (TAS-105)
 * - WS RTT + clock offset measurement (TAS-106)
 */
export function useRoomSocket({
  roomId,
  playerName,
  playerKind,
  instrument,
  onNoteEvent,
}: UseRoomSocketOptions): UseRoomSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [wsRtt, setWsRtt] = useState<number | null>(null);
  const [clockOffset, setClockOffset] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic debug payload from server
  const [aiDebugEntries, setAiDebugEntries] = useState<any[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  /** messages pressed before the socket opened; flushed on open, never dropped */
  const pendingSends = useRef<string[]>([]);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNoteEventRef = useRef(onNoteEvent);
  onNoteEventRef.current = onNoteEvent;

  // Track clock sync pings for RTT measurement
  const clockPingT0 = useRef<number>(0);

  const connect = useCallback(() => {
    // ONE SOCKET PER TAB, WHATEVER STATE THE OLD ONE IS IN. The old guard refused only when the socket
    // was already OPEN, so a connect while CONNECTING or CLOSING opened a second socket and orphaned
    // the first, which stayed open and kept its onmessage handler: measured in the 2026-10-30 16:39
    // recording, about 18 copies of every broadcast arrived on one tab, each one joining as its own peer.
    if (wsRef.current) return;

    setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // THE MOUNT IS BAKED AT BUILD TIME (see vite.config.ts): served from zpe.vc/jam the socket
    // lives at /jam/api/room/<id>/ws, and a bare /api/... would open a socket to whatever answers
    // /api on the apex, which is a different app. An absolute URL built from location.host is the
    // reference a `fetch(` scan does not see, so it is carried here by hand.
    const mount = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    const ws = new WebSocket(`${protocol}//${window.location.host}${mount}/api/room/${roomId}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // A LATE OPEN FROM A SOCKET NOBODY USES ANY MORE MUST NOT LAND. The effect re-runs when the
      // instrument resolves, so a first socket can open after its replacement is already the live one;
      // announcing it would also join the room twice.
      if (wsRef.current !== ws) return;
      setStatus('connected');
      reconnectAttempt.current = 0;

      // Send join message
      ws.send(JSON.stringify({
        type: 'join_room',
        name: playerName,
        kind: playerKind,
        instrument: instrument ?? 'PolySynth',
      }));

      // Start clock sync ping cycle for RTT measurement
      startClockSync(ws);

      // ANYTHING PRESSED WHILE THE ROOM WAS STILL CONNECTING GOES NOW, in the order it was pressed.
      const held = pendingSends.current;
      pendingSends.current = [];
      for (const message of held) ws.send(message);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;

      // EVERY MESSAGE IS KEPT, so one button can hand a listener's session to someone else to read.
      recordMessage(event.data);

      // ── Hot path: Note events bypass React ──
      if (event.data.includes('"type":"note_o')) {
        try {
          const noteEvent = JSON.parse(event.data) as NoteEvent;
          onNoteEventRef.current?.(noteEvent);
        } catch { /* malformed — ignore */ }
        return;
      }

      // ── Cold path: Parse + update React state ──
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        switch (msg.type) {
          case 'room_state':
            setRoomState(msg.roomState);
            // A FRAME WITHOUT PEERS DOES NOT EMPTY THE ROOM. One handler (the phrase-ask toggle) used
            // to broadcast room_state with no `peers`, and this line then set the list to undefined:
            // the next render spread it and the page died with "Q is not iterable". The server sends
            // them now; this keeps an older or partial frame from taking the page down.
            if (Array.isArray(msg.peers)) setPeers(msg.peers);
            beginSession(roomId);
            noteRoomState(msg.roomState);
            break;
          case 'peer_joined':
            setPeers((prev) => [...prev, msg.peer]);
            break;
          case 'peer_left':
            setPeers((prev) => prev.filter((p) => p.peerId !== msg.peerId));
            break;

          case 'agent_spawned': {
            // THE PANEL NEEDS EACH AGENT'S PART, and the peer list does not carry a style or a seat. Every
            // spawn and every change re-broadcasts this frame, so it is the one place the parts stay true.
            const spawned = msg as { peer?: { peerId?: string }; style?: string; seat?: string };
            const peerId = spawned.peer?.peerId;
            if (peerId) {
              setAgentParts(prev => {
                const next = new Map(prev);
                next.set(peerId, { style: spawned.style ?? prev.get(peerId)?.style ?? 'jazz', seat: spawned.seat ?? prev.get(peerId)?.seat ?? 'lead' });
                return next;
              });
            }
            break;
          }
          case 'metrics_snapshot':
            setMetrics(msg);
            break;
          case 'event_backfill':
            // TAS-105: Replay backfilled events silently
            for (const noteEvent of msg.events) {
              onNoteEventRef.current?.(noteEvent);
            }
            break;
          case 'clock_sync_pong':
            // Measure RTT and clock offset
            if (clockPingT0.current > 0) {
              const t3 = performance.now();
              const rtt = t3 - clockPingT0.current;
              setWsRtt(Math.round(rtt));
              // Offset = ((t1 - t0) + (t2 - t3)) / 2
              const offset = ((msg.t1 - clockPingT0.current) + (msg.t2 - t3)) / 2;
              setClockOffset(Math.round(offset));
            }
            break;
          case 'error':
            console.warn('[useRoomSocket] Server error:', msg.message);
            break;
          default: {
            // Handle ai_debug and other dynamic messages
            const loose = msg as { type: string; peerId?: unknown; instrument?: unknown };
            if (loose.type === 'ai_debug') {
              setAiDebugEntries(prev => [...prev.slice(-19), msg]);
            }
            // A PLAYER WHO SWITCHES VOICE IS HEARD SWITCHING. The server broadcasts instrument_change
            // with the peer's id, but the shared ServerMessage union has no variant for it, so it is
            // read loosely here rather than by editing a protocol file another session is also writing.
            if (loose.type === 'instrument_change' && typeof loose.peerId === 'string') {
              const peerId = loose.peerId;
              const instrument = String(loose.instrument ?? '');
              setPeers(prev => prev.map(p => (p.peerId === peerId && instrument ? { ...p, instrument } : p)));
            }
            break;
          }
        }
      } catch {
        console.warn('[useRoomSocket] Failed to parse message');
      }
    };

    // ONLY THE LIVE SOCKET'S CLOSE COUNTS. This line used to null the ref unconditionally, so when the
    // effect re-ran (the instrument prop settling from undefined to PolySynth) the FIRST socket's close
    // wiped the ref of the SECOND, which was open and working: every send then hit `readyState === OPEN`
    // on a null ref and did nothing, while clock pings sent on the captured socket proved the room was
    // alive. Measured on 2026-11-02: pressing Add an agent changed the button to "Adding..." and no frame
    // ever left the page, at random, depending on whether the stale close had fired yet.
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setStatus('disconnected');
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [roomId, playerName, playerKind, instrument]);

  const [agentParts, setAgentParts] = useState<Map<string, { style: string; seat: string }>>(() => new Map());

  const startClockSync = useCallback((ws: WebSocket) => {
    // Send clock sync ping every 30s for RTT measurement
    const sendPing = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      clockPingT0.current = performance.now();
      ws.send(JSON.stringify({
        type: 'clock_sync_ping',
        t0: clockPingT0.current,
        peerId: 'local',
      }));
    };

    // Initial ping after 1s
    setTimeout(sendPing, 1000);
    // Then every 30s
    const interval = setInterval(sendPing, 30000);

    // Clean up on disconnect
    ws.addEventListener('close', () => clearInterval(interval));
  }, []);

  const scheduleReconnect = useCallback(() => {
    const delay = RECONNECT_DELAYS[
      Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)
    ] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1]!;

    reconnectAttempt.current++;

    // One pending reconnect at a time: a second close event used to schedule a second connect, and the
    // two of them raced into the guard above.
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  /**
   * A PRESS IS NEVER SWALLOWED while the room is still connecting.
   *
   * The audio unlock clears the overlay before the socket has finished opening, so for the first second a
   * page looks ready and every send is dropped in silence. Measured on 2026-11-02 at four delays after the
   * overlay cleared: at 300 and 600 ms pressing "Add an agent" sent nothing and no bot ever arrived (0 of
   * 2); at 1500 and 3000 ms it always worked (2 of 2). The button even read "Adding..." while it did so.
   *
   * A message that cannot go now is held and flushed the moment the socket opens, so the press lands late
   * rather than never. The cap is small: a queue is for a connecting socket, not a place to pile up work.
   */
  const sendMessage = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message);
      return;
    }
    if (pendingSends.current.length < 20) pendingSends.current.push(message);
  }, []);

  const sendNoteEvent = useCallback((event: NoteEvent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return {
    status,
    roomState,
    peers,
    sendMessage,
    sendNoteEvent,
    disconnect,
    metrics,
    wsRtt,
    clockOffset,
    aiDebugEntries,
    agentParts,
  };
}
