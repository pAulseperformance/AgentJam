// Shared Music Theory, Public API
export {
  generateMeasure,
  getScaleNotes,
  // key arithmetic, used by the repairer and by anything that has to place a pitch in the key
  pitchClassOf,
  midiOf,
  noteNameFromMidi,
  scalePitchClasses,
  isInKey,
  snapPitchToKey,
} from './pattern-generator';
export type { GeneratedNote, AgentStyle } from './pattern-generator';
// THE STYLE REGISTRY. One row per style: what it means, what it plays, and what the model is told.
export { STYLE_ROWS, STYLE_IDS, styleRow, rowForBar } from './styles';
export { INSTRUMENT_IDS, DEFAULT_INSTRUMENT } from './instruments';
export type { InstrumentId } from './instruments';
export type { StyleRow, AgentStyleId, DrumHit, BassHit } from './styles';
