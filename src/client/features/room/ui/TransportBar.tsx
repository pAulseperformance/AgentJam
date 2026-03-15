import type { RoomState } from '@/shared/protocol';
import { INSTRUMENT_LIST, type InstrumentType } from '@/client/features/synth';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface TransportBarProps {
  roomState: RoomState | null;
  status: ConnectionStatus;
  onBpmChange?: (bpm: number) => void;
  onKeyChange?: (key: string) => void;
  onInstrumentChange?: (instrument: InstrumentType) => void;
  currentInstrument?: InstrumentType;
  isRecording?: boolean;
  onToggleRecording?: () => void;
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
  currentInstrument = 'PolySynth',
  isRecording = false,
  onToggleRecording,
}: TransportBarProps) {
  const bpm = roomState?.bpm ?? 120;
  const key = roomState?.key ?? 'C major';

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
    </div>
  );
}
