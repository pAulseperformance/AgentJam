import type { RoomState } from '@/shared/protocol';
import { STYLE_ROWS } from '@/shared/music/styles';
import { INSTRUMENT_LIST, type InstrumentType } from '@/client/features/synth';
import { DEFAULT_INSTRUMENT } from '@/shared/music/instruments';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface TransportBarProps {
  roomState: RoomState | null;
  status: ConnectionStatus;
  onBpmChange?: (bpm: number) => void;
  onKeyChange?: (key: string) => void;
  onInstrumentChange?: (instrument: InstrumentType) => void;
  onVibeChange?: (vibe: string) => void;
  currentInstrument?: InstrumentType;
  isRecording?: boolean;
  onToggleRecording?: () => void;
  /** the master fader: one control for the whole room, after the voices and before the limiter */
  masterVolume?: number;
  onMasterVolume?: (volume: number) => void;
}

const KEYS = [
  'C major', 'G major', 'D major', 'A major', 'E major', 'B major',
  'F major', 'Bb major', 'Eb major', 'Ab major',
  'A minor', 'E minor', 'B minor', 'D minor', 'G minor', 'C minor',
] as const;

/**
 * Displays transport state (BPM, key) and connection status.
 * BPM +/- controls and key selector (TAS-76 + TAS-83).
 */
export function TransportBar({
  roomState,
  status,
  onBpmChange,
  onKeyChange,
  onInstrumentChange,
  onVibeChange,
  currentInstrument = DEFAULT_INSTRUMENT,
  masterVolume = 0.8,
  onMasterVolume,
  isRecording = false,
  onToggleRecording,
}: TransportBarProps) {
  const bpm = roomState?.bpm ?? 120;
  const key = roomState?.key ?? 'C major';
  // THE ROOM'S VIBE. Absent means jazz, which is what the room played before the field existed.
  // The list is the registry's own, so a style cannot be offered here and missing from the table.
  const vibe = roomState?.vibe ?? 'jazz';

  const statusColor = {
    disconnected: '#ef4444',
    connecting: '#f59e0b',
    connected: '#10b981',
  }[status];

  return (
    <div className="transport-bar" role="toolbar" aria-label="Transport controls">
      {/* Connection status */}
      <div className="transport-bar__status">
        <span
          className="transport-bar__dot"
          style={{ backgroundColor: statusColor }}
          aria-hidden="true"
        />
        <span className="transport-bar__status-text">{status}</span>
      </div>

      {/* Record button (TAS-103) */}
      <button
        className={`transport-bar__btn transport-bar__record${isRecording ? ' transport-bar__record--active' : ''}`}
        onClick={onToggleRecording}
        disabled={status !== 'connected'}
        aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
        title={isRecording ? 'Stop Recording' : 'Start Recording'}
      >
        ⏺
      </button>

      {/* BPM controls */}
      <div className="transport-bar__bpm">
        <button
          className="transport-bar__btn"
          onClick={() => onBpmChange?.(Math.max(20, bpm - 5))}
          disabled={status !== 'connected'}
          aria-label="Decrease BPM"
        >
          −
        </button>
        <span className="transport-bar__bpm-value" aria-label="Current BPM">
          {bpm} BPM
        </span>
        <button
          className="transport-bar__btn"
          onClick={() => onBpmChange?.(Math.min(300, bpm + 5))}
          disabled={status !== 'connected'}
          aria-label="Increase BPM"
        >
          +
        </button>
      </div>

      {/* Key selector */}
      <div className="transport-bar__key">
        <label htmlFor="key-select" className="transport-bar__label">
          Key:
        </label>
        <select
          id="key-select"
          className="transport-bar__select"
          value={key}
          onChange={(e) => onKeyChange?.(e.target.value)}
          disabled={status !== 'connected'}
        >
          {KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>


      {/* THE ROOM'S VIBE: what every new bot is born into, and what the section follows. */}
      <div className="transport-bar__key">
        <label htmlFor="vibe-select" className="transport-bar__label">
          Vibe:
        </label>
        <select
          id="vibe-select"
          className="transport-bar__select"
          value={vibe}
          onChange={(e) => onVibeChange?.(e.target.value)}
          disabled={status !== 'connected'}
          title="The style every new bot is born into, and the style the drums and bass follow"
        >
          {STYLE_ROWS.map((row) => (
            <option key={row.id} value={row.id}>
              {row.icon} {row.label}
            </option>
          ))}
        </select>
      </div>

      {/* Instrument picker */}
      <div className="transport-bar__key">
        <label htmlFor="instrument-select" className="transport-bar__label">
          Instrument:
        </label>
        <select
          id="instrument-select"
          className="transport-bar__select"
          value={currentInstrument}
          onChange={(e) => onInstrumentChange?.(e.target.value as InstrumentType)}
          disabled={status !== 'connected'}
        >
          {INSTRUMENT_LIST.map((inst) => (
            <option key={inst.value} value={inst.value}>
              {inst.icon} {inst.label}
            </option>
          ))}
        </select>
      </div>

      {/* THE MASTER. Every player has its own fader on its card; this one moves the room. It sits last in
          the bar because it is the last thing in the signal path, and it says the number, because a fader
          with no reading is a guess. */}
      <div className="transport-bar__key transport-bar__master">
        <label htmlFor="master-volume" className="transport-bar__label">Master</label>
        <input
          id="master-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          data-master-volume={String(Math.round(masterVolume * 100))}
          onChange={(event) => onMasterVolume?.(Number(event.target.value))}
          style={{ width: 90 }}
        />
        <span className="transport-bar__label" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(masterVolume * 100)}%
        </span>
        <button
          className="transport-bar__mute"
          data-master-mute={masterVolume === 0 ? 'on' : 'off'}
          title={masterVolume === 0 ? 'Unmute the room' : 'Mute the room'}
          onClick={() => onMasterVolume?.(masterVolume === 0 ? 0.8 : 0)}
          style={{ fontSize: 11, padding: '1px 6px' }}
        >
          {masterVolume === 0 ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}
