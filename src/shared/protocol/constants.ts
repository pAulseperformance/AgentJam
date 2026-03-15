// ─── Audio & Scheduling ──────────────────────────────────────────────────────

/** Playout delay for live input — local instant, broadcast delayed by this amount */
export const PLAYOUT_DELAY_MS = 40;

/** SNTP re-sync interval — recalibrate clock offset every 30s */
export const CLOCK_SYNC_INTERVAL_MS = 30_000;

/** Auto-release notes held longer than this (MIDI panic safety) */
export const MAX_NOTE_HOLD_S = 30;

// ─── DO Performance ─────────────────────────────────────────────────────────

/** Batch SQLite flush interval — persist pending note events every 5s */
export const FLUSH_INTERVAL_MS = 5_000;

/** Max note events per second per peer — rate limit */
export const MAX_NOTES_PER_SECOND = 100;

/** Max peers per room before sharding is recommended */
export const MAX_PEERS_PER_ROOM = 50;

/** Max AI agents per room */
export const MAX_AGENTS_PER_ROOM = 4;

/** Metrics snapshot broadcast interval */
export const METRICS_INTERVAL_MS = 5_000;

/** How far back to backfill events on reconnect (ms) */
export const BACKFILL_WINDOW_MS = 10_000;

// ─── Room Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_BPM = 120;
export const DEFAULT_KEY = 'C major';
export const DEFAULT_INSTRUMENT = 'PolySynth';

// ─── Peer Colors ─────────────────────────────────────────────────────────────

/** Color palette for peer attribution — cycles if more peers than colors */
export const PEER_COLORS = [
  '#6366f1', // indigo
  '#f43f5e', // rose
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
] as const;

// ─── Protocol ────────────────────────────────────────────────────────────────

/** Hot-path string match — used by DO to relay note events without JSON.parse */
export const NOTE_EVENT_TYPE_MARKER = '"type":"note_o';

/** WebSocket close codes */
export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_GOING_AWAY = 1001;
