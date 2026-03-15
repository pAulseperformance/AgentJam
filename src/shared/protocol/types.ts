import { z } from 'zod';

// ─── Peer Types ──────────────────────────────────────────────────────────────

export const PeerKindSchema = z.enum(['human', 'agent']);
export type PeerKind = z.infer<typeof PeerKindSchema>;

export const PeerSchema = z.object({
  peerId: z.string(),
  name: z.string(),
  kind: PeerKindSchema,
  instrument: z.string(),
  color: z.string(),
});
export type Peer = z.infer<typeof PeerSchema>;

// ─── Room State ──────────────────────────────────────────────────────────────

export const RoomStateSchema = z.object({
  bpm: z.number().min(20).max(300),
  key: z.string(),
  transportStartTime: z.number(),
  serverTime: z.number(),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

// ─── Client → Server Messages ────────────────────────────────────────────────

export const JoinRoomMessageSchema = z.object({
  type: z.literal('join_room'),
  name: z.string(),
  kind: PeerKindSchema,
  instrument: z.string().optional(),
});
export type JoinRoomMessage = z.infer<typeof JoinRoomMessageSchema>;

export const NoteEventSchema = z.object({
  type: z.enum(['note_on', 'note_off']),
  peerId: z.string(),
  pitch: z.string(), // e.g. 'C4', 'F#3'
  beatTime: z.number(),
  velocity: z.number().min(0).max(127),
  timestamp: z.number(),
});
export type NoteEvent = z.infer<typeof NoteEventSchema>;

export const BpmChangeMessageSchema = z.object({
  type: z.literal('bpm_change'),
  bpm: z.number().min(20).max(300),
});
export type BpmChangeMessage = z.infer<typeof BpmChangeMessageSchema>;

export const KeyChangeMessageSchema = z.object({
  type: z.literal('key_change'),
  key: z.string(),
});
export type KeyChangeMessage = z.infer<typeof KeyChangeMessageSchema>;

export const ClockSyncPingSchema = z.object({
  type: z.literal('clock_sync_ping'),
  t0: z.number(), // performance.now() at send
  peerId: z.string(),
});
export type ClockSyncPing = z.infer<typeof ClockSyncPingSchema>;

// ─── Server → Client Messages ────────────────────────────────────────────────

export const RoomStateMessageSchema = z.object({
  type: z.literal('room_state'),
  roomState: RoomStateSchema,
  peers: z.array(PeerSchema),
});
export type RoomStateMessage = z.infer<typeof RoomStateMessageSchema>;

export const PeerJoinedMessageSchema = z.object({
  type: z.literal('peer_joined'),
  peer: PeerSchema,
});
export type PeerJoinedMessage = z.infer<typeof PeerJoinedMessageSchema>;

export const PeerLeftMessageSchema = z.object({
  type: z.literal('peer_left'),
  peerId: z.string(),
});
export type PeerLeftMessage = z.infer<typeof PeerLeftMessageSchema>;

export const ClockSyncPongSchema = z.object({
  type: z.literal('clock_sync_pong'),
  t1: z.number(), // server receive time
  t2: z.number(), // server send time
});
export type ClockSyncPong = z.infer<typeof ClockSyncPongSchema>;

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

// ─── Discriminated Union for Inbound (Client → Server) ───────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinRoomMessageSchema,
  NoteEventSchema,
  BpmChangeMessageSchema,
  KeyChangeMessageSchema,
  ClockSyncPingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Discriminated Union for Outbound (Server → Client) ──────────────────────

export const ServerMessageSchema = z.discriminatedUnion('type', [
  RoomStateMessageSchema,
  PeerJoinedMessageSchema,
  PeerLeftMessageSchema,
  ClockSyncPongSchema,
  NoteEventSchema, // note events are relayed server → client too
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
