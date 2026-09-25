import { z } from 'zod';

// ─── Peer Types ──────────────────────────────────────────────────────────────

export const PeerKindSchema = z.enum(['human', 'agent']).describe('Identifies whether a peer is a human player or an AI agent');
export type PeerKind = z.infer<typeof PeerKindSchema>;

export const PeerSchema = z.object({
  peerId: z.string().describe('Unique peer identifier assigned by the server on join'),
  name: z.string().describe('Display name shown in the peer list'),
  kind: PeerKindSchema.describe('Whether this peer is a human or AI agent'),
  instrument: z.string().describe('Instrument label shown in the UI (e.g. PolySynth)'),
  color: z.string().describe('Hex color assigned to this peer for note attribution'),
});
export type Peer = z.infer<typeof PeerSchema>;

// ─── Room State ──────────────────────────────────────────────────────────────

export const RoomStateSchema = z.object({
  bpm: z.number().min(20).max(300).describe('Room tempo in beats per minute (20–300)'),
  key: z.string().describe('Current musical key of the room (e.g. "C major", "A minor")'),
  transportStartTime: z.number().describe('Server timestamp (ms) when transport last started, used to compute current beat position'),
  serverTime: z.number().describe('Server wall-clock time (ms) at the moment this state was broadcast'),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

// ─── Client → Server Messages ────────────────────────────────────────────────

export const JoinRoomMessageSchema = z.object({
  type: z.literal('join_room').describe('Message discriminator'),
  name: z.string().describe('Display name the peer wants to use in the room'),
  kind: PeerKindSchema.describe('Whether the joining peer is a human or AI agent'),
  instrument: z.string().optional().describe('Optional instrument label; defaults to PolySynth if omitted'),
});
export type JoinRoomMessage = z.infer<typeof JoinRoomMessageSchema>;

export const NoteEventSchema = z.object({
  type: z.enum(['note_on', 'note_off']).describe('Whether this event starts or ends a note'),
  peerId: z.string().describe('Peer who produced this note event'),
  pitch: z.string().describe('Scientific pitch notation (e.g. "C4", "F#3")'),
  beatTime: z.number().describe('Absolute beat position at which this note should sound (anchored to transport start)'),
  velocity: z.number().min(0).max(127).describe('MIDI velocity (0–127); controls amplitude of the synthesized note'),
  timestamp: z.number().describe('Client performance.now() at the moment of the event, used for latency measurement'),
});
export type NoteEvent = z.infer<typeof NoteEventSchema>;

export const BpmChangeMessageSchema = z.object({
  type: z.literal('bpm_change').describe('Message discriminator'),
  bpm: z.number().min(20).max(300).describe('New tempo in beats per minute to apply to the room'),
});
export type BpmChangeMessage = z.infer<typeof BpmChangeMessageSchema>;

export const KeyChangeMessageSchema = z.object({
  type: z.literal('key_change').describe('Message discriminator'),
  key: z.string().describe('New musical key string (e.g. "G major", "D minor")'),
});
export type KeyChangeMessage = z.infer<typeof KeyChangeMessageSchema>;

export const ClockSyncPingSchema = z.object({
  type: z.literal('clock_sync_ping').describe('Message discriminator'),
  t0: z.number().describe('Client performance.now() at the moment the ping was sent'),
  peerId: z.string().describe('Peer initiating the SNTP clock synchronisation handshake'),
});
export type ClockSyncPing = z.infer<typeof ClockSyncPingSchema>;

// ─── Phase 3: Agent Control ──────────────────────────────────────────────────

export const SpawnAgentMessageSchema = z.object({
  type: z.literal('spawn_agent').describe('Message discriminator'),
  name: z.string().describe('Display name for the agent that will be spawned'),
  style: z.enum(['jazz', 'ambient', 'funk', 'random']).describe('Generation style that determines the musical character of the agent'),
});
export type SpawnAgentMessage = z.infer<typeof SpawnAgentMessageSchema>;

export const DespawnAgentMessageSchema = z.object({
  type: z.literal('despawn_agent').describe('Message discriminator'),
  agentPeerId: z.string().describe('Peer ID of the agent to remove from the room'),
});
export type DespawnAgentMessage = z.infer<typeof DespawnAgentMessageSchema>;

export const InstrumentChangeMessageSchema = z.object({
  type: z.literal('instrument_change').describe('Message discriminator'),
  instrument: z.string().describe('New instrument label to apply to the requesting peer'),
});
export type InstrumentChangeMessage = z.infer<typeof InstrumentChangeMessageSchema>;

export const RecordingStartMessageSchema = z.object({
  type: z.literal('recording_start').describe('Message discriminator — signals the server to begin buffering note events for recording'),
});
export type RecordingStartMessage = z.infer<typeof RecordingStartMessageSchema>;

export const RecordingStopMessageSchema = z.object({
  type: z.literal('recording_stop').describe('Message discriminator — signals the server to stop buffering and flush the recording'),
});
export type RecordingStopMessage = z.infer<typeof RecordingStopMessageSchema>;

// ─── Server → Client Messages ────────────────────────────────────────────────

export const RoomStateMessageSchema = z.object({
  type: z.literal('room_state').describe('Message discriminator'),
  roomState: RoomStateSchema.describe('Full room state snapshot sent to peers on join or transport change'),
  peers: z.array(PeerSchema).describe('List of all currently connected peers at the time of this broadcast'),
});
export type RoomStateMessage = z.infer<typeof RoomStateMessageSchema>;

export const PeerJoinedMessageSchema = z.object({
  type: z.literal('peer_joined').describe('Message discriminator'),
  peer: PeerSchema.describe('Metadata for the peer who just joined the room'),
});
export type PeerJoinedMessage = z.infer<typeof PeerJoinedMessageSchema>;

export const PeerLeftMessageSchema = z.object({
  type: z.literal('peer_left').describe('Message discriminator'),
  peerId: z.string().describe('ID of the peer who disconnected'),
});
export type PeerLeftMessage = z.infer<typeof PeerLeftMessageSchema>;

export const ClockSyncPongSchema = z.object({
  type: z.literal('clock_sync_pong').describe('Message discriminator'),
  t1: z.number().describe('Server performance.now() when the ping was received'),
  t2: z.number().describe('Server performance.now() when this pong was sent'),
});
export type ClockSyncPong = z.infer<typeof ClockSyncPongSchema>;

export const ErrorMessageSchema = z.object({
  type: z.literal('error').describe('Message discriminator'),
  message: z.string().describe('Human-readable error description'),
  code: z.string().optional().describe('Optional machine-readable error code for client-side handling'),
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

// ─── Phase 3: Server → Client ────────────────────────────────────────────────

export const AgentSpawnedMessageSchema = z.object({
  type: z.literal('agent_spawned').describe('Message discriminator'),
  peer: PeerSchema.describe('Peer metadata for the newly spawned AI agent'),
  style: z.string().describe('Generation style the agent is using (jazz, ambient, funk, or random)'),
});
export type AgentSpawnedMessage = z.infer<typeof AgentSpawnedMessageSchema>;

export const PeerMetricsSchema = z.object({
  peerId: z.string().describe('Peer whose metrics are reported'),
  notesPerSec: z.number().describe('Average note events per second over the last measurement window'),
  activeNoteCount: z.number().describe('Number of pitches currently held (note_on without matching note_off)'),
});
export type PeerMetrics = z.infer<typeof PeerMetricsSchema>;

export const MetricsSnapshotSchema = z.object({
  type: z.literal('metrics_snapshot').describe('Message discriminator'),
  peerCount: z.number().describe('Total number of connected peers (human + agent)'),
  agentCount: z.number().describe('Number of AI agent peers currently in the room'),
  totalNotesPerSec: z.number().describe('Sum of note event rates across all peers'),
  peerMetrics: z.array(PeerMetricsSchema).describe('Per-peer breakdown of note activity'),
  uptimeMs: z.number().describe('Milliseconds since the JamRoom DO was instantiated'),
  serverTime: z.number().describe('Server wall-clock time (ms) when this snapshot was generated'),
});
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

export const EventBackfillMessageSchema = z.object({
  type: z.literal('event_backfill').describe('Message discriminator'),
  events: z.array(NoteEventSchema).describe('Batch of historical note events replayed to a peer that reconnected late'),
  backfillFromTimestamp: z.number().describe('The earliest timestamp covered by the backfill, in server ms'),
});
export type EventBackfillMessage = z.infer<typeof EventBackfillMessageSchema>;

// ─── Discriminated Union for Inbound (Client → Server) ───────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinRoomMessageSchema,
  NoteEventSchema,
  BpmChangeMessageSchema,
  KeyChangeMessageSchema,
  ClockSyncPingSchema,
  SpawnAgentMessageSchema,
  DespawnAgentMessageSchema,
  InstrumentChangeMessageSchema,
  RecordingStartMessageSchema,
  RecordingStopMessageSchema,
  z.object({ type: z.literal('set_agent_model'), agentPeerId: z.string(), model: z.string() }),
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
  AgentSpawnedMessageSchema,
  MetricsSnapshotSchema,
  EventBackfillMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;


