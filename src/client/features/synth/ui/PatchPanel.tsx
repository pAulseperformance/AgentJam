import { useCallback, useState } from 'react';
import { PRESETS } from '@/shared/music/presets';
import {
  FILTER_TYPES,
  FLAT_EQ,
  MOD_SHAPES,
  MOD_TARGETS,
  WAVE_SHAPES,
  normalizePatch,
  patchFromPreset,
  type Patch,
  type WaveShape,
} from '@/shared/music/patch';
import { deletePatch, savePatch, savedPatches, type SavedPatch } from '@/client/features/synth/lib/patch-store';
import { Knob } from './Knob';

/**
 * THE SYNTH'S FRONT PANEL.
 *
 * A room of agents is a band, and a band with one tone between them is not a band. This is the surface a
 * synth has, section by section, in the order a person learns one: a starting patch, then the oscillator,
 * the filter, the amplifier, the equaliser, two modulators, and the effects.
 *
 * It is drawn as hardware rather than as a form of sliders: a knob is read as a position, each section has
 * its own bezel and accent, and the three displays (wave, envelope, filter and EQ response) are drawn from
 * the SAME numbers the engine gets, so what the surface claims and what the room plays cannot drift.
 */
interface PatchPanelProps {
  /** whose voice this is, so the panel says what it is editing */
  name: string;
  patch: Patch;
  /** a FUNCTION of the freshest patch: several controls moved in one frame must not overwrite each other */
  onChange: (updater: (prev: Patch) => Patch) => void;
  /** false when the selected card is not a bot, so the panel can say why it is inert */
  editable: boolean;
}

/** One bezelled section of the panel. */
function Section({
  title,
  accent,
  children,
  hint,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="patch__section" style={{ borderColor: 'var(--border)' }} data-section={title.toLowerCase()}>
      <header className="patch__section-head">
        <span className="patch__led" style={{ background: accent }} aria-hidden="true" />
        <strong>{title}</strong>
        {hint ? <span className="patch__hint">{hint}</span> : null}
      </header>
      <div className="patch__section-body">{children}</div>
    </section>
  );
}

/** A wave, drawn from the numbers the oscillator gets. */
function wavePath(wave: WaveShape, width: number, height: number): string {
  const points: string[] = [];
  for (let x = 0; x <= width; x += 1) {
    const t = (x / width) * Math.PI * 2 * 2;
    let v: number;
    switch (wave) {
      case 'sine': v = Math.sin(t); break;
      case 'triangle': v = (2 / Math.PI) * Math.asin(Math.sin(t)); break;
      case 'square':
      case 'pulse': v = Math.sin(t) >= 0 ? 1 : -1; break;
      case 'fatsawtooth':
      case 'sawtooth':
      default: v = 2 * ((t / (Math.PI * 2)) % 1) - 1; break;
    }
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${(height / 2 - (v * height) / 2.6).toFixed(1)}`);
  }
  return points.join(' ');
}

/** The amplifier envelope, as the shape of one note. */
function envelopePath(patch: Patch, width: number, height: number): string {
  const total = patch.env.attack + patch.env.decay + 1 + patch.env.release;
  const x = (seconds: number) => (seconds / total) * width;
  const y = (level: number) => height - level * (height - 5) - 2.5;
  const { attack, decay, sustain, release } = patch.env;
  return [
    `M0,${y(0)}`,
    `L${x(attack).toFixed(1)},${y(1)}`,
    `L${x(attack + decay).toFixed(1)},${y(sustain)}`,
    `L${x(attack + decay + 1).toFixed(1)},${y(sustain)}`,
    `L${x(attack + decay + 1 + release).toFixed(1)},${y(0)}`,
  ].join(' ');
}

/** The filter's response, so a cutoff is something you see rather than infer. */
function filterPath(patch: Patch, width: number, height: number): string {
  const points: string[] = [];
  for (let i = 0; i <= width; i += 2) {
    const f = 10 ** (1.5 + (i / width) * 3.4);
    const ratio = f / patch.filter.cutoff;
    const q = patch.filter.resonance;
    let gain = 1;
    if (patch.filter.type === 'lowpass') gain = 1 / Math.sqrt(1 + ratio ** 4);
    else if (patch.filter.type === 'highpass') gain = 1 / Math.sqrt(1 + (1 / ratio) ** 4);
    else gain = Math.exp(-((Math.log(ratio) * 1.6) ** 2));
    const bump = 1 + (q / 12) * Math.exp(-((Math.log(ratio) * 4) ** 2));
    const level = Math.min(1, gain * bump);
    points.push(`${i === 0 ? 'M' : 'L'}${i},${(height - level * (height - 6) - 3).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * The equaliser as a curve: three bands summed in decibels, drawn across 40 Hz to 12 kHz. It is the same
 * shape the three filters make, so a boosted top looks like a boosted top.
 */
function eqPath(patch: Patch, width: number, height: number): string {
  const eq = normalizePatch(patch).eq;
  const points: string[] = [];
  for (let i = 0; i <= width; i += 2) {
    const f = 40 * (12000 / 40) ** (i / width);
    const lowShelf = eq.low / (1 + (f / eq.lowFreq) ** 2);
    const highShelf = eq.high / (1 + (eq.highFreq / f) ** 2);
    const midFreq = Math.sqrt(eq.lowFreq * eq.highFreq);
    const bell = eq.mid * Math.exp(-((Math.log(f / midFreq) * 2.2) ** 2));
    const db = lowShelf + bell + highShelf;
    points.push(`${i === 0 ? 'M' : 'L'}${i},${(height / 2 - (db / 18) * (height / 2 - 3)).toFixed(1)}`);
  }
  return points.join(' ');
}

export function PatchPanel({ name, patch, onChange, editable }: PatchPanelProps) {
  const full = normalizePatch(patch);
  const [library, setLibrary] = useState<SavedPatch[]>(() => savedPatches());
  const [saveName, setSaveName] = useState('');

  const set = useCallback(<K extends keyof Patch>(key: K, value: Patch[K]) => {
    onChange(prev => ({ ...prev, [key]: value }));
  }, [onChange]);

  const setMod = useCallback((index: 0 | 1, next: Partial<Patch['mods'] extends undefined ? never : NonNullable<Patch['mods']>[number]>) => {
    onChange(prev => {
      const mods = normalizePatch(prev).mods;
      const updated = [...mods] as typeof mods;
      updated[index] = { ...updated[index], ...next } as typeof mods[0];
      return { ...prev, mods: updated };
    });
  }, [onChange]);

  return (
    <div className="patch" data-editable={editable ? 'yes' : 'no'}>
      <div className="patch__head">
        <div>
          <strong className="patch__title">{editable ? `Voice of ${name}` : `${name} is a listener`}</strong>
          <span className="patch__sub">
            {editable ? 'everyone in the room hears every move' : 'pick a bot card to edit its voice'}
          </span>
        </div>
        <div className="patch__save">
          <input
            className="patch__save-name"
            value={saveName}
            placeholder="name this patch"
            aria-label="patch name"
            disabled={!editable}
            onChange={event => setSaveName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || !saveName.trim()) return;
              setLibrary(savePatch(saveName.trim(), patch));
              setSaveName('');
            }}
          />
          <button
            className="patch__btn"
            data-patch-action="save"
            disabled={!editable || !saveName.trim()}
            onClick={() => { setLibrary(savePatch(saveName.trim(), patch)); setSaveName(''); }}
          >
            Save
          </button>
        </div>
      </div>

      {/* FACTORY PATCHES: a whole sound, not a label. */}
      <div className="patch__strip">
        <span className="patch__strip-label">Factory</span>
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`patch__chip ${patch.base === preset.id ? 'patch__chip--on' : ''}`}
            data-preset={preset.id}
            disabled={!editable}
            title={`Load ${preset.label}`}
            onClick={() => onChange(() => patchFromPreset(preset.id))}
          >
            {preset.icon} {preset.label}
          </button>
        ))}
      </div>

      {library.length > 0 && (
        <div className="patch__strip">
          <span className="patch__strip-label">Mine</span>
          {library.map(entry => (
            <span key={entry.name} className="patch__chip patch__chip--saved" data-saved={entry.name}>
              <button
                className="patch__chip-load"
                disabled={!editable}
                title={`Load ${entry.name}`}
                onClick={() => onChange(() => entry.patch)}
              >
                {entry.name}
              </button>
              <button
                className="patch__chip-x"
                title={`Delete ${entry.name}`}
                onClick={() => setLibrary(deletePatch(entry.name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="patch__grid">
        <Section title="Oscillator" accent="#7dd3fc" hint="what the voice is made of">
          <svg width="100%" height="52" viewBox="0 0 240 52" preserveAspectRatio="none" aria-label="waveform" data-patch-wave={patch.wave}>
            <rect x="0" y="0" width="240" height="52" rx="4" fill="rgba(255,255,255,0.04)" />
            <path d={wavePath(patch.wave, 240, 52)} stroke="#7dd3fc" strokeWidth="1.8" fill="none" />
          </svg>
          <div className="patch__btnrow">
            {WAVE_SHAPES.map(shape => (
              <button
                key={shape}
                className={`patch__btn ${patch.wave === shape ? 'patch__btn--on' : ''}`}
                data-wave={shape}
                disabled={!editable}
                onClick={() => set('wave', shape)}
              >
                {shape === 'fatsawtooth' ? 'super saw' : shape}
              </button>
            ))}
          </div>
          <div className="patch__knobs">
            <Knob label="Voices" value={patch.voices} min={1} max={5} step={1} format={v => `${v}`} resetTo={1} disabled={!editable} accent="#7dd3fc" onChange={v => set('voices', v)} />
            <Knob label="Detune" value={patch.detune} min={0} max={60} step={1} format={v => `${Math.round(v)} ct`} resetTo={0} disabled={!editable} accent="#7dd3fc" onChange={v => set('detune', v)} />
            <Knob label="Octave" value={patch.octave} min={-2} max={2} step={1} format={v => (v > 0 ? `+${v}` : `${v}`)} resetTo={0} disabled={!editable} accent="#7dd3fc" onChange={v => set('octave', v)} />
            <Knob label="Sub" value={full.sub} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} resetTo={0} disabled={!editable} accent="#7dd3fc" onChange={v => set('sub', v)} />
            <Knob label="Glide" value={full.glide} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'off' : `${v.toFixed(2)}s`)} resetTo={0} disabled={!editable} accent="#7dd3fc" onChange={v => set('glide', v)} />
          </div>
        </Section>

        <Section title="Filter" accent="#fca5a5" hint="what it keeps">
          <svg width="100%" height="52" viewBox="0 0 240 52" preserveAspectRatio="none" aria-label="filter" data-filter-curve={patch.filter.type}>
            <rect x="0" y="0" width="240" height="52" rx="4" fill="rgba(255,255,255,0.04)" />
            <path d={filterPath(patch, 240, 52)} stroke="#fca5a5" strokeWidth="1.8" fill="none" />
          </svg>
          <div className="patch__btnrow">
            {FILTER_TYPES.map(type => (
              <button
                key={type}
                className={`patch__btn ${patch.filter.type === type ? 'patch__btn--on' : ''}`}
                data-filter-type={type}
                disabled={!editable}
                onClick={() => onChange(prev => ({ ...prev, filter: { ...prev.filter, type } }))}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="patch__knobs">
            <Knob label="Cutoff" value={patch.filter.cutoff} min={80} max={12000} step={10} format={v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)} resetTo={12000} disabled={!editable} accent="#fca5a5" onChange={v => onChange(prev => ({ ...prev, filter: { ...prev.filter, cutoff: v } }))} />
            <Knob label="Resonance" value={patch.filter.resonance} min={0} max={12} step={0.1} format={v => v.toFixed(1)} resetTo={0.7} disabled={!editable} accent="#fca5a5" onChange={v => onChange(prev => ({ ...prev, filter: { ...prev.filter, resonance: v } }))} />
          </div>
        </Section>

        <Section title="Amplifier" accent="#fcd34d" hint="the shape of one note">
          <svg width="100%" height="52" viewBox="0 0 240 52" preserveAspectRatio="none" aria-label="envelope" data-env-curve={`${patch.env.attack}-${patch.env.release}`}>
            <rect x="0" y="0" width="240" height="52" rx="4" fill="rgba(255,255,255,0.04)" />
            <path d={envelopePath(patch, 240, 52)} stroke="#fcd34d" strokeWidth="1.8" fill="none" />
          </svg>
          <div className="patch__knobs">
            <Knob label="Attack" value={patch.env.attack} min={0.001} max={4} step={0.01} format={v => `${v.toFixed(2)}s`} resetTo={0.01} disabled={!editable} accent="#fcd34d" onChange={v => onChange(prev => ({ ...prev, env: { ...prev.env, attack: v } }))} />
            <Knob label="Decay" value={patch.env.decay} min={0.01} max={4} step={0.01} format={v => `${v.toFixed(2)}s`} resetTo={0.3} disabled={!editable} accent="#fcd34d" onChange={v => onChange(prev => ({ ...prev, env: { ...prev.env, decay: v } }))} />
            <Knob label="Sustain" value={patch.env.sustain} min={0} max={1} step={0.01} format={v => v.toFixed(2)} resetTo={0.4} disabled={!editable} accent="#fcd34d" onChange={v => onChange(prev => ({ ...prev, env: { ...prev.env, sustain: v } }))} />
            <Knob label="Release" value={patch.env.release} min={0.01} max={6} step={0.01} format={v => `${v.toFixed(2)}s`} resetTo={0.8} disabled={!editable} accent="#fcd34d" onChange={v => onChange(prev => ({ ...prev, env: { ...prev.env, release: v } }))} />
          </div>
        </Section>

        <Section title="Equaliser" accent="#86efac" hint="where it sits in the band">
          <svg width="100%" height="52" viewBox="0 0 240 52" preserveAspectRatio="none" aria-label="equaliser" data-eq-curve={`${full.eq.low}/${full.eq.mid}/${full.eq.high}`}>
            <rect x="0" y="0" width="240" height="52" rx="4" fill="rgba(255,255,255,0.04)" />
            <line x1="0" y1="26" x2="240" y2="26" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 4" />
            <path d={eqPath({ ...patch, eq: full.eq }, 240, 52)} stroke="#86efac" strokeWidth="1.8" fill="none" />
          </svg>
          <div className="patch__knobs">
            <Knob label="Low" value={full.eq.low} min={-18} max={18} step={0.5} format={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`} resetTo={0} disabled={!editable} accent="#86efac" onChange={v => onChange(prev => ({ ...prev, eq: { ...normalizePatch(prev).eq, low: v } }))} />
            <Knob label="Mid" value={full.eq.mid} min={-18} max={18} step={0.5} format={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`} resetTo={0} disabled={!editable} accent="#86efac" onChange={v => onChange(prev => ({ ...prev, eq: { ...normalizePatch(prev).eq, mid: v } }))} />
            <Knob label="High" value={full.eq.high} min={-18} max={18} step={0.5} format={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`} resetTo={0} disabled={!editable} accent="#86efac" onChange={v => onChange(prev => ({ ...prev, eq: { ...normalizePatch(prev).eq, high: v } }))} />
            <Knob label="Low freq" value={full.eq.lowFreq} min={60} max={600} step={5} format={v => `${Math.round(v)}Hz`} resetTo={FLAT_EQ.lowFreq} disabled={!editable} accent="#86efac" onChange={v => onChange(prev => ({ ...prev, eq: { ...normalizePatch(prev).eq, lowFreq: v } }))} />
            <Knob label="High freq" value={full.eq.highFreq} min={1200} max={8000} step={20} format={v => `${(v / 1000).toFixed(1)}k`} resetTo={FLAT_EQ.highFreq} disabled={!editable} accent="#86efac" onChange={v => onChange(prev => ({ ...prev, eq: { ...normalizePatch(prev).eq, highFreq: v } }))} />
          </div>
        </Section>

        {([0, 1] as const).map(index => {
          const mod = full.mods[index];
          const accent = index === 0 ? '#c4b5fd' : '#f0abfc';
          return (
            <Section key={index} title={`Modulator ${index + 1}`} accent={accent} hint={`sends to ${mod.target}`}>
              <div className="patch__btnrow">
                {MOD_SHAPES.map(shape => (
                  <button
                    key={shape}
                    className={`patch__btn ${mod.shape === shape ? 'patch__btn--on' : ''}`}
                    data-mod={index}
                    data-mod-shape={shape}
                    disabled={!editable}
                    onClick={() => setMod(index, { shape })}
                  >
                    {shape}
                  </button>
                ))}
                <select
                  className="patch__select"
                  aria-label={`modulator ${index + 1} destination`}
                  data-mod-target={index}
                  value={mod.target}
                  disabled={!editable}
                  onChange={event => setMod(index, { target: event.target.value as typeof MOD_TARGETS[number] })}
                >
                  {MOD_TARGETS.map(target => <option key={target} value={target}>{target}</option>)}
                </select>
              </div>
              <div className="patch__knobs">
                <Knob label="Rate" value={mod.rate} min={0.02} max={16} step={0.02} format={v => `${v.toFixed(2)}Hz`} resetTo={5} disabled={!editable} accent={accent} onChange={v => setMod(index, { rate: v })} />
                <Knob label="Depth" value={mod.depth} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} resetTo={0} disabled={!editable} accent={accent} onChange={v => setMod(index, { depth: v })} />
              </div>
            </Section>
          );
        })}

        <Section title="Effects" accent="#fdba74" hint="after the voice">
          <div className="patch__knobs">
            <Knob label="Chorus" value={patch.chorus} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} resetTo={0} disabled={!editable} accent="#fdba74" onChange={v => set('chorus', v)} />
            <Knob label="Drive" value={patch.drive} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} resetTo={0} disabled={!editable} accent="#fdba74" onChange={v => set('drive', v)} />
            <Knob label="Level" value={patch.level} min={-30} max={6} step={0.5} format={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`} resetTo={-6} disabled={!editable} accent="#fdba74" onChange={v => set('level', v)} />
          </div>
        </Section>
      </div>
    </div>
  );
}
