import { useCallback } from 'react';
import { PRESETS } from '@/shared/music/presets';
import {
  FILTER_TYPES,
  WAVE_SHAPES,
  type Patch,
  type WaveShape,
} from '@/shared/music/patch';

/**
 * THE SYNTH'S FRONT PANEL.
 *
 * The room had presets and nothing to move on them: a listener could choose "Juno Pad" and could not
 * change a cutoff. This is the surface a synth has, in the order a person learns one: pick a starting
 * preset, choose the waveform, stack it, shape the envelope, then open the filter and add movement.
 *
 * Every control writes the whole patch back, so the sound on the page and the numbers the room plays are
 * the same object rather than two states to keep in step.
 */
interface PatchPanelProps {
  /** whose voice this is, so the panel says what it is editing */
  name: string;
  patch: Patch;
  onChange: (patch: Patch) => void;
  /** false when the selected card is not a bot, so the panel can say why it is inert */
  editable: boolean;
}

/** One labelled control, with its reading beside the label so a value is never a mystery. */
function Knob({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="patch__knob" style={{ display: 'grid', gap: 2 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        data-patch={label.toLowerCase()}
        onChange={event => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/** A wave, drawn from the same numbers the oscillator gets. */
function wavePath(wave: WaveShape, width: number, height: number): string {
  const points: string[] = [];
  const cycles = 2;
  for (let x = 0; x <= width; x += 1) {
    const t = (x / width) * Math.PI * 2 * cycles;
    let v: number;
    switch (wave) {
      case 'sine': v = Math.sin(t); break;
      case 'triangle': v = (2 / Math.PI) * Math.asin(Math.sin(t)); break;
      case 'square':
      case 'pulse': v = Math.sin(t) >= 0 ? 1 : -1; break;
      case 'sawtooth':
      case 'fatsawtooth':
      default: v = 2 * ((t / (Math.PI * 2)) % 1) - 1; break;
    }
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${(height / 2 - (v * height) / 2.4).toFixed(1)}`);
  }
  return points.join(' ');
}

/** The envelope, drawn as the shape of one note. */
function envelopePath(patch: Patch, width: number, height: number): string {
  const total = patch.env.attack + patch.env.decay + 1.2 + patch.env.release;
  const x = (seconds: number) => (seconds / total) * width;
  const y = (level: number) => height - level * (height - 4) - 2;
  const { attack, decay, sustain, release } = patch.env;
  return [
    `M0,${y(0)}`,
    `L${x(attack).toFixed(1)},${y(1)}`,
    `L${x(attack + decay).toFixed(1)},${y(sustain)}`,
    `L${x(attack + decay + 1.2).toFixed(1)},${y(sustain)}`,
    `L${x(attack + decay + 1.2 + release).toFixed(1)},${y(0)}`,
  ].join(' ');
}

/** The filter's response, so a cutoff is something a person can see rather than infer. */
function filterPath(patch: Patch, width: number, height: number): string {
  const points: string[] = [];
  const cutoff = Math.log10(patch.filter.cutoff);
  for (let i = 0; i <= width; i += 2) {
    const f = 10 ** (1.5 + (i / width) * 3.4); // 30 Hz to 10 kHz across the box
    const ratio = f / patch.filter.cutoff;
    const q = patch.filter.resonance;
    let gain = 1;
    if (patch.filter.type === 'lowpass') gain = 1 / Math.sqrt(1 + ratio ** 4);
    else if (patch.filter.type === 'highpass') gain = 1 / Math.sqrt(1 + (1 / ratio) ** 4);
    else gain = Math.exp(-((Math.log(ratio) * 1.6) ** 2));
    // a resonance bump at the corner, which is what the Q is for
    const bump = 1 + (q / 12) * Math.exp(-((Math.log(ratio) * 4) ** 2));
    const level = Math.min(1, gain * bump);
    points.push(`${i === 0 ? 'M' : 'L'}${i},${(height - level * (height - 6) - 3).toFixed(1)}`);
  }
  void cutoff;
  return points.join(' ');
}

export function PatchPanel({ name, patch, onChange, editable }: PatchPanelProps) {
  const set = useCallback(<K extends keyof Patch>(key: K, value: Patch[K]) => {
    onChange({ ...patch, [key]: value });
  }, [patch, onChange]);

  return (
    <div className="patch" style={{ display: 'grid', gap: 10, opacity: editable ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 12 }}>{editable ? `Voice of ${name}` : `${name} is a listener`}</strong>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{editable ? 'everyone in the room hears this' : 'pick a bot card to edit its voice'}</span>
      </div>

      {/* START FROM A PRESET: the panel opens on a sound rather than on zeroes. */}
      <div className="patch__presets" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`patch__preset ${patch.base === preset.id ? 'patch__preset--on' : ''}`}
            data-preset={preset.id}
            disabled={!editable}
            title={`Start from ${preset.label}`}
            onClick={() => onChange({ ...patch, base: preset.id })}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            {preset.icon} {preset.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'center' }}>
        <svg width="120" height="48" viewBox="0 0 120 48" aria-label="waveform" data-patch-wave={patch.wave}>
          <rect x="0" y="0" width="120" height="48" rx="4" fill="rgba(255,255,255,0.04)" />
          <path d={wavePath(patch.wave, 120, 48)} stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
        <div className="patch__waves" style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {WAVE_SHAPES.map(shape => (
            <button
              key={shape}
              className={`patch__wave ${patch.wave === shape ? 'patch__wave--on' : ''}`}
              data-wave={shape}
              disabled={!editable}
              onClick={() => set('wave', shape)}
              style={{ fontSize: 10, padding: '2px 6px' }}
            >
              {shape.replace('fatsawtooth', 'super saw')}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Knob label="Voices" value={patch.voices} min={1} max={5} step={1} format={v => `${v}`} disabled={!editable} onChange={v => set('voices', v)} />
        <Knob label="Detune" value={patch.detune} min={0} max={60} step={1} format={v => `${v} ct`} disabled={!editable} onChange={v => set('detune', v)} />
        <Knob label="Octave" value={patch.octave} min={-2} max={2} step={1} format={v => (v > 0 ? `+${v}` : `${v}`)} disabled={!editable} onChange={v => set('octave', v)} />
      </div>

      <svg width="100%" height="40" viewBox="0 0 240 40" preserveAspectRatio="none" aria-label="envelope">
        <rect x="0" y="0" width="240" height="40" rx="4" fill="rgba(255,255,255,0.04)" />
        <path d={envelopePath(patch, 240, 40)} stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        <Knob label="Attack" value={patch.env.attack} min={0.001} max={4} step={0.01} format={v => `${v.toFixed(2)}s`} disabled={!editable} onChange={v => set('env', { ...patch.env, attack: v })} />
        <Knob label="Decay" value={patch.env.decay} min={0.01} max={4} step={0.01} format={v => `${v.toFixed(2)}s`} disabled={!editable} onChange={v => set('env', { ...patch.env, decay: v })} />
        <Knob label="Sustain" value={patch.env.sustain} min={0} max={1} step={0.01} format={v => v.toFixed(2)} disabled={!editable} onChange={v => set('env', { ...patch.env, sustain: v })} />
        <Knob label="Release" value={patch.env.release} min={0.01} max={6} step={0.01} format={v => `${v.toFixed(2)}s`} disabled={!editable} onChange={v => set('env', { ...patch.env, release: v })} />
      </div>

      <svg width="100%" height="34" viewBox="0 0 240 34" preserveAspectRatio="none" aria-label="filter">
        <rect x="0" y="0" width="240" height="34" rx="4" fill="rgba(255,255,255,0.04)" />
        <path d={filterPath(patch, 240, 34)} stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <label className="patch__knob" style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 11 }}>Filter</span>
          <select
            value={patch.filter.type}
            disabled={!editable}
            aria-label="filter type"
            data-patch="filter type"
            onChange={event => set('filter', { ...patch.filter, type: event.target.value as Patch['filter']['type'] })}
            style={{ fontSize: 11 }}
          >
            {FILTER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <Knob label="Cutoff" value={patch.filter.cutoff} min={80} max={12000} step={10} format={v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)} disabled={!editable} onChange={v => set('filter', { ...patch.filter, cutoff: v })} />
        <Knob label="Resonance" value={patch.filter.resonance} min={0} max={12} step={0.1} format={v => v.toFixed(1)} disabled={!editable} onChange={v => set('filter', { ...patch.filter, resonance: v })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
        <Knob label="LFO rate" value={patch.lfo.rate} min={0.05} max={14} step={0.05} format={v => `${v.toFixed(1)}Hz`} disabled={!editable} onChange={v => set('lfo', { ...patch.lfo, rate: v })} />
        <Knob label="LFO depth" value={patch.lfo.depth} min={0} max={1} step={0.01} format={v => v.toFixed(2)} disabled={!editable} onChange={v => set('lfo', { ...patch.lfo, depth: v })} />
        <Knob label="Chorus" value={patch.chorus} min={0} max={1} step={0.01} format={v => v.toFixed(2)} disabled={!editable} onChange={v => set('chorus', v)} />
        <Knob label="Drive" value={patch.drive} min={0} max={1} step={0.01} format={v => v.toFixed(2)} disabled={!editable} onChange={v => set('drive', v)} />
        <Knob label="Level" value={patch.level} min={-30} max={0} step={0.5} format={v => `${v.toFixed(1)}dB`} disabled={!editable} onChange={v => set('level', v)} />
      </div>
    </div>
  );
}
