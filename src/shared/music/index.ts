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
