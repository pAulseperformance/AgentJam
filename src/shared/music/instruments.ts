/**
 * THE VOICES THE ENGINE IMPLEMENTS, named once.
 *
 * The union used to live in the client's audio engine, so the server could not validate an instrument
 * and a style row could not name one: every row said `PolySynth` because nothing read the field. Shared
 * code cannot import from the client, so the list lives here and the engine derives its own type from it.
 *
 * A voice is not a style. A style is how a part is composed; a voice is what it sounds like. A pla from
 * a PluckSynth is the same notes as a pla from a PolySynth, heard differently, which is why the two are
 * separate fields on separate objects.
 */
// MembraneSynth is implemented by the engine (it is the voice the room's own bass and kick use) and has
// no entry in the panel's list, so it is a legal spawn voice that a listener cannot pick by hand. The list
// and the union are the same set, which is what lets the server refuse a voice the engine cannot play.
export const INSTRUMENT_IDS = ['PolySynth', 'AMSynth', 'FMSynth', 'DrumKit', 'PluckSynth', 'MembraneSynth'] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

/** The voice a bot plays when neither it nor its style row names one. */
export const DEFAULT_INSTRUMENT: InstrumentId = 'PolySynth';
