import { z } from 'zod';
import { STYLE_IDS, type AgentStyleId } from '@/shared/music/styles';
import { INSTRUMENT_IDS } from '@/shared/music/instruments';
import { LEGACY_INSTRUMENT_ALIASES } from '@/shared/music/presets';

/**
 * A player's instrument, as the wire names it: a preset patch, or one of the six synth classes the wire
 * used before presets. The legacy names are accepted at the door and mapped, so a page loaded before the
 * deploy still joins instead of being refused.
 */
const InstrumentOnWire = z.enum([...INSTRUMENT_IDS, ...Object.keys(LEGACY_INSTRUMENT_ALIASES)] as [string, ...string[]]);

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
  /**
   * WHETHER A GAP BAR RESTS. On, a bar the agent did not answer with the model plays silence instead
   * of the room's own fill (its cells above a stride of one, the generator's line at a stride of one),
   * so an agent that writes every second bar is heard as space rather than as a denser one. Optional
   * because a room that has never been asked sends nothing here, and nothing means off: the fill is
   * the room's default, and rests are the listener's choice.
   */
  gapRests: z.boolean().optional().describe('Whether a bar the agent did not write with the model rests instead of playing the room’s own fill'),
  phraseAsk: z.boolean().optional().describe('Whether one model call writes four bars for this room instead of one call per bar'),
  /**
   * THE ROOM'S VIBE: the style every new bot is born into, and the style the backing section follows.
   * Optional because a room that has never been set sends nothing, and nothing means jazz, which is
   * what the room played before this field existed. A PART's own style still wins: the vibe fills
   * defaults, it does not rewrite a bot that is already playing.
   */
  vibe: z.string().optional().describe('Style every new bot is born into, and the style the backing section follows'),
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
  at: z.number().optional().describe('Epoch ms of the slot this note belongs to on the room clock, so a client can schedule it instead of playing on arrival'),
  in: z.number().optional().describe('The same slot as a delay in ms from the moment the message left the server, which needs no clock agreement between browser and server'),
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
  style: z.enum(STYLE_IDS as [AgentStyleId, ...AgentStyleId[]]).optional().describe('Generation style that determines the musical character of the agent; absent means the room\'s vibe'),
  /**
   * THE VOICE THIS BOT PLAYS. Absent means the style row's own instrument, which is what makes a latin row
   * that names a pluck actually heard as a pluck. An id the engine does not implement is refused here
   * rather than defaulted, because a silently defaulted voice is a spawn that looks successful.
   */
  instrument: InstrumentOnWire.optional().describe('Instrument the bot plays (a preset patch); absent means the style row\'s instrument'),
  /**
   * THE SEAT THIS BOT TAKES. Absent means the first seat the room does not already cover. The three
   * melodic seats are a PREFERENCE the phrase arc may override; the two rhythm seats hand the matching
   * backing layer over so the kit and the low end are each played once.
   */
  seat: z.enum(['drums', 'bass', 'lead', 'answer', 'ornament']).optional().describe('Seat the bot takes; absent means the first uncovered one'),
});
export type SpawnAgentMessage = z.infer<typeof SpawnAgentMessageSchema>;

export const DespawnAgentMessageSchema = z.object({
  type: z.literal('despawn_agent').describe('Message discriminator'),
  agentPeerId: z.string().describe('Peer ID of the agent to remove from the room'),
});
export type DespawnAgentMessage = z.infer<typeof DespawnAgentMessageSchema>;

export const SetBackingMessageSchema = z.object({
  type: z.literal('set_backing').describe('Message discriminator: turn the room rhythm section on or off'),
  drummer: z.boolean().describe('Whether a drummer should back the room'),
  bass: z.boolean().describe('Whether a bass player should back the room'),
});
export type SetBackingMessage = z.infer<typeof SetBackingMessageSchema>;

/**
 * THE ROOM'S HEDGE. On, every bar the room writes is asked for twice, 200 ms apart, and the first
 * valid answer is the bar; off, a bar costs one call. Off is the default because the second call is
 * real money, so turning it on is the room owner's decision and not a policy an agent takes itself.
 */
export const SetHedgeMessageSchema = z.object({
  type: z.literal('set_hedge').describe('Message discriminator: turn the hedged ask on or off for this room'),
  enabled: z.boolean().describe('Whether a bar spends two model calls, the second issued 200 ms after the first'),
});
export type SetHedgeMessage = z.infer<typeof SetHedgeMessageSchema>;

/**
 * GAP BARS AS RESTS. On, every bar the agent did not answer with the model is silence: no cells above
 * a stride of one, no generator line at a stride of one. Off is the room's default, because the fill
 * keeps the room sounding while the model answers as often as it can, and whether the slower rate
 * reads as space or as absence is a listener's call rather than something the room can measure.
 */
export const SetGapRestsMessageSchema = z.object({
  type: z.literal('set_gap_rests').describe('Message discriminator: make a gap bar a rest for this room'),
  enabled: z.boolean().describe('Whether a bar the agent did not write with the model is silence instead of the room’s own fill'),
});
export type SetGapRestsMessage = z.infer<typeof SetGapRestsMessageSchema>;

/**
 * ONE CALL, FOUR BARS. The room asks the model for a whole phrase on the bar that opens it and queues
 * the four bars at once, so three of the four cost no call. Off by default: the per-bar ask is the
 * shape every other measurement was taken against, and a four-bar answer arrives as one object that a
 * small model truncates often.
 */
export const SetPhraseAskMessageSchema = z.object({
  type: z.literal('set_phrase_ask').describe('Message discriminator: one model call per four bars for this room'),
  enabled: z.boolean().describe('Whether the agent is asked for a four-bar phrase instead of one bar'),
});
export type SetPhraseAskMessage = z.infer<typeof SetPhraseAskMessageSchema>;


/**
 * THE ROOM'S VIBE. It fills the defaults for every bot born after it and sets the style the backing
 * section plays; a bot's own style still wins, because a room setting that rewrote a playing part
 * would be one listener's click changing everybody's band with no undo.
 */
export const SetVibeMessageSchema = z.object({
  type: z.literal('set_vibe').describe('Message discriminator: set the style the room is playing in'),
  vibe: z.enum(STYLE_IDS as [AgentStyleId, ...AgentStyleId[]]).describe('The style the room sets as its vibe'),
});
export type SetVibeMessage = z.infer<typeof SetVibeMessageSchema>;

/**
 * ONE AGENT'S PART, CHANGED FROM ITS CARD. A style, a voice and a seat are the three things a player is,
 * and the panel's fine controls write them here rather than asking for a respawn: a listener tuning the
 * band should hear the change on the next bar, not lose the idea the bot was developing.
 */
export const SetAgentPartSchema = z.object({
  type: z.literal('set_agent_part').describe('Message discriminator: change one agent\'s style, voice or seat'),
  agentPeerId: z.string().describe('Peer id of the agent to change'),
  style: z.enum([...STYLE_IDS] as [AgentStyleId, ...AgentStyleId[]]).optional().describe('New style for this agent'),
  instrument: InstrumentOnWire.optional().describe('New instrument (a preset patch) for this agent'),
  seat: z.enum(['drums', 'bass', 'lead', 'answer', 'ornament']).optional().describe('New seat for this agent'),
});
export type SetAgentPartMessage = z.infer<typeof SetAgentPartSchema>;

export const InstrumentChangeMessageSchema = z.object({
  type: z.literal('instrument_change').describe('Message discriminator'),
  instrument: z.string().describe('New instrument label to apply to the requesting peer'),
});
export type InstrumentChangeMessage = z.infer<typeof InstrumentChangeMessageSchema>;

export const RecordingStartMessageSchema = z.object({
  type: z.literal('recording_start').describe('Message discriminator, signals the server to begin buffering note events for recording'),
});
export type RecordingStartMessage = z.infer<typeof RecordingStartMessageSchema>;

export const RecordingStopMessageSchema = z.object({
  type: z.literal('recording_stop').describe('Message discriminator, signals the server to stop buffering and flush the recording'),
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
  seat: z.string().optional().describe('The seat the agent took, when it took one'),
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
  SetBackingMessageSchema,
  SetHedgeMessageSchema,
  SetGapRestsMessageSchema,
  SetPhraseAskMessageSchema,
  SetVibeMessageSchema,
  SetAgentPartSchema,
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


