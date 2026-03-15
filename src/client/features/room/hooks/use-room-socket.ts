import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  Peer,
  RoomState,
  ServerMessage,
  NoteEvent,
} from '@/shared/protocol';

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
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000] as const;

/**
 * Manages the WebSocket connection to a JamRoom Durable Object.
 *
 * v5 patterns implemented:
 * - Note events bypass React state (routed via onNoteEvent callback)
 * - Automatic reconnection with exponential backoff
 * - Room state + peer list managed in React state (infrequent updates)
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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNoteEventRef = useRef(onNoteEvent);
  onNoteEventRef.current = onNoteEvent;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/room/${roomId}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      reconnectAttempt.current = 0;

      // Send join message
      ws.send(JSON.stringify({
        type: 'join_room',
        name: playerName,
        kind: playerKind,
        instrument: instrument ?? 'PolySynth',
      }));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;

      // ── Hot path: Note events bypass React ──
      // Check raw string before JSON.parse — same marker as server
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
            setPeers(msg.peers);
            break;
          case 'peer_joined':
            setPeers((prev) => [...prev, msg.peer]);
            break;
          case 'peer_left':
            setPeers((prev) => prev.filter((p) => p.peerId !== msg.peerId));
            break;
          case 'error':
            console.warn('[useRoomSocket] Server error:', msg.message);
            break;
          // clock_sync_pong handled by clock-sync.ts (TAS-69)
        }
      } catch {
        console.warn('[useRoomSocket] Failed to parse message');
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [roomId, playerName, playerKind, instrument]);

  const scheduleReconnect = useCallback(() => {
    const delay = RECONNECT_DELAYS[
      Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)
    ] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1]!;

    reconnectAttempt.current++;

    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  const sendMessage = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message);
    }
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

  return { status, roomState, peers, sendMessage, sendNoteEvent, disconnect };
}
