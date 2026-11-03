import { useState } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { AtmosGLPane } from './AtmosGLPane';
import { BandViewPane, type BandNote } from './BandViewPane';
import { MetersPane } from './MetersPane';
import { SpectrumPane } from './SpectrumPane';
import { StereoPane } from './StereoPane';

/**
 * THE VISUALIZER DOCK: every reading the room can give, one at a time, added BELOW the keyboard.
 *
 * The note roll above the keyboard stays exactly as it was. These are the panes it cannot be: who is
 * playing what (band), the frequencies of the output (spectrum), the signal as a scope and a
 * spectrogram (meters), and the mood (atmosphere). Each is a question, and a pane that answered two of
 * them at once would be the "one picture that means everything" this whole pass exists to avoid.
 */
const PANES = [
  { id: 'spectrum', label: 'Spectrum', hint: 'the frequencies of the room output' },
  { id: 'band', label: 'Band', hint: 'who is playing what, lane per player' },
  { id: 'meters', label: 'Meters', hint: 'scope, spectrogram, peak and RMS' },
  { id: 'stereo', label: 'Stereo', hint: 'goniometer, correlation, width and the two channels' },
  { id: 'atmos', label: 'Atmos', hint: 'shader feedback on the room, nothing faster than the music' },
  { id: 'patch', label: 'Patch', hint: "the selected bot's synth: waveform, envelope, filter and movement" },
] as const;

type PaneId = (typeof PANES)[number]['id'];

interface VisualizerDockProps {
  engine: AudioEngine | null;
  notesRef: React.RefObject<BandNote[]>;
  names?: Map<string, string>;
  width?: number;
  height?: number;
  /** the synth front panel, rendered in its own tab: a control surface, not a reading */
  patchPanel?: React.ReactNode;
}

export function VisualizerDock({ engine, notesRef, names, width = 800, height = 200, patchPanel }: VisualizerDockProps) {
  // SPECTRUM BY DEFAULT, because it is the pane a person expects to find and the one that answers
  // "is the room doing anything" in a glance.
  // THE PATCH IS THE DEFAULT PANE: the room is an instrument, and the first thing a person wants is the
  // surface that shapes it, not a reading of it.
  const [pane, setPane] = useState<PaneId>('patch');

  return (
    <section className="visualizer-dock" data-pane={pane} aria-label="Visualizers">
      <div className="visualizer-dock__tabs" role="tablist" style={{ display: 'flex', gap: 6, margin: '8px 0 4px' }}>
        {PANES.map(entry => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={pane === entry.id}
            title={entry.hint}
            data-pane-tab={entry.id}
            onClick={() => setPane(entry.id)}
            style={{
              font: 'inherit',
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 999,
              cursor: 'pointer',
              color: 'inherit',
              background: 'transparent',
              border: `1px solid ${pane === entry.id ? 'currentColor' : 'transparent'}`,
              opacity: pane === entry.id ? 1 : 0.6,
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {pane === 'band' && <BandViewPane engine={engine} notesRef={notesRef} names={names} width={width} height={height} />}
      {pane === 'spectrum' && <SpectrumPane engine={engine} width={width} height={height} />}
      {pane === 'meters' && <MetersPane engine={engine} width={width} height={height} />}
      {pane === 'stereo' && <StereoPane engine={engine} width={width} height={height} />}
      {pane === 'atmos' && <AtmosGLPane engine={engine} width={width} height={height} />}
      {pane === 'patch' && (patchPanel ?? <p style={{ fontSize: 12, opacity: 0.7 }}>Pick your own name to patch your keyboard, or a bot card to patch that player.</p>)}
    </section>
  );
}
