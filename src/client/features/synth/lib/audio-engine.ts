import * as Tone from 'tone';
import { PLAYOUT_DELAY_MS, MAX_NOTE_HOLD_S } from '@/shared/protocol/constants';

// ── Instrument Definitions ────────────────────────────────────────────────

import { DEFAULT_INSTRUMENT, type InstrumentId } from '@/shared/music/instruments';
import { PRESETS, presetById, presetsByFamily, type PresetPatch } from '@/shared/music/presets';
import { normalizePatch, polyOptionsOf, type Patch } from '@/shared/music/patch';
import { meterFromSpectrum } from './meter';

// THE VOICE LIST IS SHARED. It lives in shared/music/instruments so the SERVER can validate a spawn and a
// style row can name its own voice; this type is the engine's view of the same five ids.
export type InstrumentType = InstrumentId;

/**
 * THE CARD'S INSTRUMENT LIST IS THE PRESET TABLE, grouped by family.
 *
 * It used to be six hand-written engines ("Classic", "AM Synth"), so a bot born into any style read as
 * the same instrument. A preset is a whole patch: oscillator stack, envelope, filter and movement.
 */
export const INSTRUMENT_LIST: { value: InstrumentType; label: string; icon: string; family: string }[] =
  PRESETS.map(preset => ({ value: preset.id, label: preset.label, icon: preset.icon, family: preset.family }));

/** The same list in the groups the picker shows. */
export const INSTRUMENT_GROUPS = presetsByFamily().map(group => ({
  family: group.family,
  entries: group.presets.map(preset => ({ value: preset.id as InstrumentType, label: preset.label, icon: preset.icon })),
}));

/** Whether a player's instrument is the room's own drum map rather than a pitched synth. */
export function isKitPreset(id: string): boolean {
  return presetById(id)?.synth === 'kit';
}

/**
 * A REAL DRUM KIT, not a pitched synth pretending.
 *
 * A single MembraneSynth for every drum code made the room's drummer sound like a sink being hit: a
 * kick, a snare and a hi-hat are three different instruments (a membrane, a noise burst, and a bright
 * metallic tick). The server sends drum CODES as pitches (C2 kick, G2 tom, D3 snare, A5 hat), so this
 * maps a code to the voice that makes that sound.
 */
interface DrumVoice {
  trigger(pitch: string, when: number, velocity: number): void;
  dispose(): void;
}

function createDrumKit(output: Tone.InputNode): DrumVoice {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.06,
    octaves: 6,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.42, sustain: 0.001, release: 0.01 },
    volume: 2,
  }).connect(output);

  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 3,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0.001, release: 0.01 },
    volume: -2,
  }).connect(output);

  // a snare is a noise burst with a short body: wider, darker, and shaped by a fast decay
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.02 },
    volume: -4,
  }).connect(output);

  // a hat is a shorter, brighter tick: pink noise through a high band keeps it from sounding like a
  // snare, and 60ms is the difference between a hat and a hiss
  const hat = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.01 },
    volume: -8,
  }).connect(output);

  return {
    trigger(pitch: string, when: number, velocity: number): void {
      const v = Math.max(0.02, Math.min(1, velocity));
      switch (pitch) {
        case 'C2': kick.triggerAttackRelease('C1', 0.4, when, v); break;
        case 'G2': tom.triggerAttackRelease('G2', 0.22, when, v); break;
        case 'D3': snare.triggerAttack(when, v); snare.triggerRelease(when + 0.19); break;
        case 'A5': hat.triggerAttack(when, v); hat.triggerRelease(when + 0.06); break;
        default: kick.triggerAttackRelease('C1', 0.35, when, v); break;
      }
    },
    dispose(): void {
      kick.dispose(); tom.dispose(); snare.dispose(); hat.dispose();
    },
  };
}

/** Each player's starting gain, so a full room sums close to unity rather than far past it. */
const VOICE_TRIM = 0.6;

/** The Tone.js class each preset's synth kind is built on. */
const SYNTH_CLASS = {
  Synth: Tone.Synth,
  AMSynth: Tone.AMSynth,
  FMSynth: Tone.FMSynth,
  MembraneSynth: Tone.MembraneSynth,
  PluckSynth: Tone.Synth,
} as const;

/**
 * THE EFFECTS A PATCH CARRIES, kept beside the synth so replacing a voice can dispose them.
 *
 * A PolySynth alone can only sound like its oscillator. The patch's character is the filter that opens
 * over a pad, the chorus that widens an electric piano and the vibrato on a reed: without disposing them
 * a player who changes instrument three times leaves three chains running into the master bus, which is
 * the leak this map exists to close.
 */
const CHAINS = new WeakMap<Tone.PolySynth, Tone.ToneAudioNode[]>();

function createInstrumentSynth(id: InstrumentType, output: Tone.InputNode): Tone.PolySynth {
  const preset: PresetPatch = presetById(id) ?? presetById('electric-piano')!;
  const SynthClass = SYNTH_CLASS[preset.synth === 'kit' ? 'Synth' : preset.synth];
  const synth = new Tone.PolySynth(SynthClass as typeof Tone.Synth, preset.options as never);
  if (preset.volume !== undefined) synth.volume.value = preset.volume;

  // the chain, in the order a signal meets it: drive, then tone, then movement
  const chain: Tone.ToneAudioNode[] = [];
  if (preset.distortion) chain.push(new Tone.Distortion(preset.distortion));
  if (preset.filter) chain.push(new Tone.Filter({ ...preset.filter, type: preset.filter.type }));
  if (preset.chorus) chain.push(new Tone.Chorus({ ...preset.chorus }).start());
  if (preset.vibrato) chain.push(new Tone.Vibrato(preset.vibrato));

  let node: Tone.ToneAudioNode = synth;
  for (const effect of chain) {
    node.connect(effect);
    node = effect;
  }
  node.connect(output);
  CHAINS.set(synth, chain);
  return synth;
}

/**
 * A VOICE BUILT FROM A PATCH, for the panel's numbers rather than a preset's.
 *
 * Same shape as the preset builder (bank, then drive, filter, chorus, vibrato), but every value comes from
 * the patch the player is dragging, so what the panel shows IS what the engine plays.
 */
function createPatchSynth(patch: Patch, output: Tone.InputNode): Tone.PolySynth {
  const full = normalizePatch(patch);
  const synth = new Tone.PolySynth(Tone.Synth, polyOptionsOf(patch) as never);
  synth.volume.value = patch.level;

  const chain: Tone.ToneAudioNode[] = [];
  if (patch.drive > 0.01) chain.push(new Tone.Distortion({ distortion: patch.drive, wet: patch.drive }));

  // THE EQUALISER, and it is a real three band one: low shelf, bell, high shelf, each with its own gain and
  // the two crossovers the panel draws. Flat EQ is skipped entirely so a clean patch costs no node.
  const eq = full.eq;
  const eqActive = Math.abs(eq.low) > 0.1 || Math.abs(eq.mid) > 0.1 || Math.abs(eq.high) > 0.1;
  if (eqActive) {
    chain.push(new Tone.Filter({ type: 'lowshelf', frequency: eq.lowFreq, gain: eq.low }));
    chain.push(new Tone.Filter({ type: 'peaking', frequency: Math.sqrt(eq.lowFreq * eq.highFreq), Q: 1, gain: eq.mid }));
    chain.push(new Tone.Filter({ type: 'highshelf', frequency: eq.highFreq, gain: eq.high }));
  }

  const filter = new Tone.Filter({ type: patch.filter.type, frequency: patch.filter.cutoff, Q: patch.filter.resonance });
  chain.push(filter);

  // TWO MODULATORS, EACH SENDING WHERE THE PATCH SAYS. Pitch is a vibrato, level a tremolo, and filter an
  // LFO on the cutoff between a quarter and four times it, which is how a synth sweep is actually made.
  const mods = full.mods;
  const mods3: Tone.ToneAudioNode[] = [];
  const [pitchMod, filterMod, levelMod] = [
    mods.find(mod => mod.target === 'pitch' && mod.depth > 0.001),
    mods.find(mod => mod.target === 'filter' && mod.depth > 0.001),
    mods.find(mod => mod.target === 'level' && mod.depth > 0.001),
  ];
  if (pitchMod) mods3.push(new Tone.Vibrato({ frequency: pitchMod.rate, depth: Math.min(0.95, pitchMod.depth) }));
  if (levelMod) mods3.push(new Tone.Tremolo({ frequency: levelMod.rate, depth: Math.min(0.95, levelMod.depth), spread: 60 }).start());
  if (filterMod) {
    const lfo = new Tone.LFO({
      frequency: filterMod.rate,
      min: Math.max(80, patch.filter.cutoff * 0.25),
      max: Math.min(12000, patch.filter.cutoff * 4),
    });
    lfo.connect(filter.frequency);
    lfo.start();
    mods3.push(lfo as unknown as Tone.ToneAudioNode);
  }
  chain.push(...mods3);

  if (patch.chorus > 0.01) chain.push(new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.6, wet: patch.chorus }).start());
  if (full.sub > 0.01) chain.push(new Tone.Gain(1 + full.sub * 0.4));

  let node: Tone.ToneAudioNode = synth;
  for (const effect of chain) {
    node.connect(effect);
    node = effect;
  }
  node.connect(output);
  CHAINS.set(synth, chain);
  return synth;
}

/** Replace or drop a voice without leaking its effects into the master bus. */
function disposeInstrument(synth: Tone.PolySynth): void {
  const chain = CHAINS.get(synth);
  if (chain) {
    for (const effect of chain) effect.dispose();
    CHAINS.delete(synth);
  }
  synth.dispose();
}

/**
 * AudioEngine, Vanilla TypeScript class (NOT a React hook).
 *
 * v5 Pattern: This class operates entirely outside React's lifecycle.
 * It is created once and accessed via ref, note events from the WebSocket
 * are routed directly here without triggering React re-renders.
 *
 * Added: Per-peer Gain nodes for individual volume control & mute.
 */
export class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private activeNotes: Map<string, { releaseTimer: ReturnType<typeof setTimeout> }> = new Map();
  private clockOffset = 0;
  private started = false;
  private currentInstrument: InstrumentType = DEFAULT_INSTRUMENT;

  /** Per-peer synth instances keyed by peerId, different instruments per peer */
  private peerSynths: Map<string, Tone.PolySynth> = new Map();
  /** Per-peer drum kits: a kit is not a PolySynth, it is four one-shot voices */
  private peerKits: Map<string, DrumVoice> = new Map();
  /** The local player's kit, when they pick Drums */
  private localKit: DrumVoice | null = null;
  /** Per-peer instrument type tracking */
  private peerInstruments: Map<string, InstrumentType> = new Map();
  /** hand-built patches per player, kept so the panel opens on the voice that is playing */
  private peerPatches: Map<string, Patch> = new Map();
  /** Per-peer volume nodes: peerId → Gain */
  private peerGains: Map<string, Tone.Gain> = new Map();
  /** Per-peer pan position, and the node that applies it once the voice exists */
  private peerPans: Map<string, number> = new Map();
  private peerPanners: Map<string, Tone.Panner> = new Map();
  /** Master volume for local player */
  private masterGain: Tone.Gain | null = null;
  /** nothing reaches the speakers above -1 dBFS, whatever the voices add up to */
  private masterLimiter: Tone.Limiter | null = null;
  /**
   * AN ANALYSER ON THE OUTPUT, so the meter shows what the room SOUNDS like.
   *
   * The page's note roll draws rectangles from the note event stream and reads no audio at all; its
   * own comment called it a waveform until 2026-11-02, which is how a reader came away believing the
   * room had ears. This node is the only thing on the page that touches the signal.
   */
  private analyser: Tone.Analyser | null = null;
  /** The time-domain twin. A spectrum says which frequencies, a scope says the shape of the wave. */
  private scope: Tone.Analyser | null = null;
  /** Muted peers set */
  private mutedPeers: Set<string> = new Set();
  /** Master volume as a plain number (0-1), applied as velocity multiplier */
  private masterVolumeLevel = 1;
  private masterMutedState = false;

  async start(): Promise<void> {
    if (this.started) return;

    await Tone.start();

    // THE MASTER CHAIN ENDS IN A LIMITER, and that is the answer to "I can hear clipping from agents".
    //
    // Four players on a PolySynth each summed to the destination with nothing holding the sum down: a
    // three-voice pad, a membrane kick at +2 dB and a saw lead arrive on the same millisecond and the sum
    // passes 1.0, which the hardware turns into a click. A limiter at -1 dB makes that arithmetically
    // impossible, and it is the only place in the graph where that can be guaranteed.
    this.masterGain = new Tone.Gain(1);
    this.masterLimiter = new Tone.Limiter(-1).toDestination();
    this.masterGain.connect(this.masterLimiter);
    // THE BUS MUST NOT COLLAPSE TO MONO. A gain node upmixes whatever arrives to its own channel count,
    // and with an explicit mono count every panned voice arrives identical on both channels: the room
    // reported a perfect correlation with the band spread across the field.
    this.masterGain.channelCount = 2;
    this.masterGain.channelCountMode = 'max';
    // 64 bins is enough for 16 bars and cheap enough to read every frame at 30 fps.
    this.analyser = new Tone.Analyser('fft', 128);
    this.masterGain.connect(this.analyser);
    // TWO CHANNELS, because the room now has a stereo field: every peer is panned by its seat, so a
    // goniometer and a width meter read something real instead of a mono line. The channel count is a
    // CONSTRUCTION option in Tone, not a property, so it is passed here and getValue() answers an array
    // of one buffer per channel.
    this.scope = new Tone.Analyser({ type: 'waveform', size: 512, channels: 2 });
    this.masterGain.connect(this.scope);
    if (isKitPreset(this.currentInstrument)) {
      this.localKit = createDrumKit(this.masterGain);
    } else {
      this.synth = createInstrumentSynth(this.currentInstrument, this.masterGain);
      this.synth.maxPolyphony = 16;
    }

    this.started = true;
  }

  dispose(): void {
    if (this.synth) {
      this.synth.releaseAll();
      disposeInstrument(this.synth);
      this.synth = null;
    }
    for (const [, synth] of this.peerSynths) {
      synth.releaseAll();
      synth.dispose();
    }
    this.peerSynths.clear();
    for (const [, kit] of this.peerKits) kit.dispose();
    this.peerKits.clear();
    if (this.localKit) { this.localKit.dispose(); this.localKit = null; }
    this.peerInstruments.clear();
    for (const [, gain] of this.peerGains) {
      gain.dispose();
    }
    this.peerGains.clear();
    if (this.masterGain) {
      this.masterGain.dispose();
      this.masterGain = null;
    }
    for (const [, { releaseTimer }] of this.activeNotes) {
      clearTimeout(releaseTimer);
    }
    this.activeNotes.clear();
    this.started = false;
  }

  getToneNow(): number {
    return Tone.now();
  }

  getAudioContext(): AudioContext | null {
    return Tone.getContext().rawContext as AudioContext | null;
  }

  setClockOffset(offset: number): void {
    this.clockOffset = offset;
  }

  getNetworkTime(): number {
    return Tone.now() + this.clockOffset;
  }

  // ── Per-Peer Volume Control ─────────────────────────────────────────

  /**
   * Get or create a Gain node for a peer.
   * Each remote peer gets their own Gain node for independent volume control.
   */
  /**
   * WHERE EVERY VOICE LANDS. The local player's synth and every remote peer's gain feed the master
   * gain, and the analyser listens there, so the meter hears the ROOM. A peer gain wired straight to
   * the destination bypasses this bus, which is what made the first deployed meter read zero while the
   * band played: the room was audible and unmeasurable at the same time.
   */
  private outputBus(): Tone.InputNode {
    return this.masterGain ?? Tone.getDestination();
  }

  private getOrCreatePeerGain(peerId: string): Tone.Gain {
    let gain = this.peerGains.get(peerId);
    if (!gain) {
      const panner = new Tone.Panner(this.peerPans.get(peerId) ?? 0);
      // HEADROOM PER VOICE. Each player starts a little under unity, because a room is a SUM: four
      // players at 1.0 is 4.0 before the limiter has to rescue it, and a limiter working that hard is
      // audible as pumping. The individual fader on the card sits on top of this.
      gain = new Tone.Gain(VOICE_TRIM).connect(panner);
      panner.connect(this.outputBus());
      this.peerPans.set(peerId, panner.pan.value as number);
      this.peerPanners.set(peerId, panner);
      this.peerGains.set(peerId, gain);
    }
    return gain;
  }

  /**
   * WHERE A PEER SITS IN THE FIELD, from -1 to +1. The page assigns this by SEAT, so the same band is
   * laid out the same way on every listener's machine, and a bot that takes a lane sounds like it is
   * standing there rather than on top of everyone else.
   */
  setPeerPan(peerId: string, pan: number): void {
    const clamped = Math.max(-1, Math.min(1, pan));
    this.peerPans.set(peerId, clamped);
    const existing = this.peerPanners.get(peerId);
    if (existing) {
      existing.pan.value = clamped;
      return;
    }
    // A panner that arrives before the voice is remembered and applied when the gain is built.
  }

  /** Set volume for a specific peer (0-1 range) */
  setPeerVolume(peerId: string, volume: number): void {
    const gain = this.getOrCreatePeerGain(peerId);
    gain.gain.value = Math.max(0, Math.min(1, volume));
  }

  /** Get current volume for a peer */
  getPeerVolume(peerId: string): number {
    return this.peerGains.get(peerId)?.gain.value ?? 1;
  }

  /** Set master volume (local player), stored as field, applied in playNote */
  /**
   * THE METER'S READING, in bars from 0 to 1, taken from the analyser on the master gain.
   *
   * Zeros before the engine has started, which is the honest answer: a page that has not been armed
   * has no output to measure, and a meter reading full at that moment would be drawing something else.
   */
  /**
   * BOTH READINGS AT ONCE, for the panes that need them: the spectrum in decibels and the waveform in
   * samples. Null before the audio overlay is answered, which is the honest answer for a page that has
   * not been armed.
   */
  analyserSnapshot(): {
    spectrum: Float32Array<ArrayBufferLike>;
    wave: Float32Array<ArrayBufferLike>;
    left: Float32Array<ArrayBufferLike>;
    right: Float32Array<ArrayBufferLike>;
    /** how many buffers the analyser answered, so a reader can tell a mono tap from a stereo one */
    channels: number;
  } | null {
    if (!this.analyser) return null;
    const fft = this.analyser.getValue();
    const spectrum = Array.isArray(fft) ? (fft[0] ?? new Float32Array(0)) : fft;
    let left: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let right: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let channels = 1;
    if (this.scope) {
      const time = this.scope.getValue() as unknown;
      // TONE DOES NOT GUARANTEE THE SHAPE, so it is read rather than assumed: a mono analyser answers a
      // Float32Array, a multi-channel one answers an ARRAY OF THEM, and both have been seen. Treating
      // the mono shape as stereo returns the SAME buffer twice, which is how the goniometer reported a
      // perfect correlation in a room that was panned.
      if (Array.isArray(time)) {
        channels = time.length;
        left = (time[0] as Float32Array<ArrayBufferLike>) ?? new Float32Array(0);
        right = (time[1] as Float32Array<ArrayBufferLike>) ?? left;
      } else if (time instanceof Float32Array) {
        left = time;
        right = time;
      }
    }
    return { spectrum, wave: left, left, right, channels };
  }

  meterLevels(bars = 16): number[] {
    if (!this.analyser) return new Array(Math.max(1, bars)).fill(0);
    const values = this.analyser.getValue();
    // A multi-channel analyser answers one array per channel; the room is mono in practice, so the
    // first channel is the room.
    const spectrum = Array.isArray(values) ? (values[0] ?? new Float32Array(0)) : values;
    return meterFromSpectrum(spectrum, bars);
  }

  /**
   * THE MASTER FADER. It scales the sum AFTER the voices, so one slider moves the whole room and the
   * limiter still stands between the room and the speakers.
   */
  setMasterVolume(volume: number): void {
    this.masterVolumeLevel = Math.max(0, Math.min(1, volume));
    // THE FADER MOVES THE BUS, not the velocity of the notes this page happens to send: scaling velocity
    // silenced your own keys and left every agent exactly as loud, which is the opposite of a master fader.
    this.masterGain?.gain.rampTo(this.masterVolumeLevel, 0.05);
  }

  /** Get master volume */
  getMasterVolume(): number {
    return this.masterVolumeLevel;
  }

  /** Mute/unmute a peer */
  setMuted(peerId: string, muted: boolean): void {
    if (muted) {
      this.mutedPeers.add(peerId);
      this.setPeerVolume(peerId, 0);
    } else {
      this.mutedPeers.delete(peerId);
      // Restore to default volume, caller should set actual volume
      this.setPeerVolume(peerId, 1);
    }
  }

  /** Check if a peer is muted */
  isMuted(peerId: string): boolean {
    return this.mutedPeers.has(peerId);
  }

  /** Mute/unmute local (master) */
  setMasterMuted(muted: boolean): void {
    this.masterMutedState = muted;
  }

  // ── Instrument Management ──────────────────────────────────────────

  /** Change the local player's instrument */
  changeInstrument(instrument: InstrumentType): void {
    if (!this.masterGain) return;
    this.currentInstrument = instrument;

    // Release all active notes, swap synth
    if (this.synth) {
      this.synth.releaseAll();
      disposeInstrument(this.synth);
      this.synth = null;
    }
    // Switching to drums swaps the melodic synth for a kit, and back again
    if (this.localKit) { this.localKit.dispose(); this.localKit = null; }
    if (isKitPreset(instrument)) {
      this.localKit = createDrumKit(this.masterGain);
      return;
    }
    this.synth = createInstrumentSynth(instrument, this.masterGain);
    this.synth.maxPolyphony = 16;
  }

  /**
   * A DEPARTED PEER GIVES ITS VOICES BACK. `peer_left` only filtered the React list, so every drummer
   * that left leaked a Tone.Gain and four one-shot voices for the life of the tab.
   */
  removePeer(peerId: string): void {
    const kit = this.peerKits.get(peerId);
    if (kit) { kit.dispose(); this.peerKits.delete(peerId); }
    const synth = this.peerSynths.get(peerId);
    if (synth) { synth.releaseAll(); disposeInstrument(synth); this.peerSynths.delete(peerId); }
    const gain = this.peerGains.get(peerId);
    if (gain) { gain.dispose(); this.peerGains.delete(peerId); }
    this.peerInstruments.delete(peerId);
    this.mutedPeers.delete(peerId);
  }

  /** Get current instrument */
  getInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  /**
   * Set the instrument for a remote peer. IDEMPOTENT: the room re-sends the peer list on every
   * change, so a caller may state the instrument every time; rebuilding the synth each time would
   * cut whatever that peer is holding.
   */
  setPeerInstrument(peerId: string, instrument: InstrumentType): void {
    const hasVoice = this.peerSynths.has(peerId) || this.peerKits.has(peerId);
    if (hasVoice && this.peerInstruments.get(peerId) === instrument) return;

    // a kit and a synth cannot both exist for the same peer
    const kit = this.peerKits.get(peerId);
    if (kit) { kit.dispose(); this.peerKits.delete(peerId); }

    if (isKitPreset(instrument)) {
      const existing = this.peerSynths.get(peerId);
      if (existing) { existing.releaseAll(); disposeInstrument(existing); this.peerSynths.delete(peerId); }
      this.peerKits.set(peerId, createDrumKit(this.getOrCreatePeerGain(peerId)));
      this.peerInstruments.set(peerId, instrument);
      return;
    }

    const existing = this.peerSynths.get(peerId);
    if (existing) {
      existing.releaseAll();
      existing.dispose();
    }
    const gain = this.getOrCreatePeerGain(peerId);
    const synth = createInstrumentSynth(instrument, gain);
    synth.maxPolyphony = 8;
    this.peerSynths.set(peerId, synth);
    this.peerInstruments.set(peerId, instrument);
  }

  /**
   * A HAND-BUILT PATCH, for one player. Replaces whatever voice was there, kits included, because a patch
   * is a complete instrument: leaving a kit underneath a synth patch would stack two voices on one part.
   */
  setPeerPatch(peerId: string, patch: Patch): void {
    const kit = this.peerKits.get(peerId);
    if (kit) { kit.dispose(); this.peerKits.delete(peerId); }
    const existing = this.peerSynths.get(peerId);
    if (existing) {
      existing.releaseAll();
      disposeInstrument(existing);
      this.peerSynths.delete(peerId);
    }
    const synth = createPatchSynth(patch, this.getOrCreatePeerGain(peerId));
    synth.maxPolyphony = 8;
    this.peerSynths.set(peerId, synth);
    this.peerPatches.set(peerId, patch);
  }

  /** The patch a player is playing, so the panel can open on the sound the room hears. */
  getPeerPatch(peerId: string): Patch | undefined {
    return this.peerPatches.get(peerId);
  }

  /** Get the synth for a remote peer, creating a default if needed */
  private getOrCreatePeerSynth(peerId: string): Tone.PolySynth {
    let synth = this.peerSynths.get(peerId);
    if (!synth) {
      const gain = this.getOrCreatePeerGain(peerId);
      synth = createInstrumentSynth(DEFAULT_INSTRUMENT, gain);
      synth.maxPolyphony = 8;
      this.peerSynths.set(peerId, synth);
    }
    return synth;
  }

  // ── Note Playback ───────────────────────────────────────────────────

  /**
   * Play a note with per-peer volume routing.
   * peerId is used to route through the peer's Gain node.
   */
  playNote(pitch: string, velocity: number, isRemote: boolean, peerId?: string, delayMs?: number): void {
    // A kit has no melodic synth, so this guard cannot be a synth check alone
    if (!this.synth && !this.localKit && this.peerKits.size === 0) return;

    // If this is a muted peer, skip entirely
    if (peerId && this.mutedPeers.has(peerId)) return;
    // If local and master is muted, skip
    if (!isRemote && this.masterMutedState) return;

    const normalizedVelocity = velocity / 127;
    const key = peerId ? `${peerId}:${pitch}` : pitch;

    // A caller that knows the note's slot passes it; anything else keeps the old playout delay. A
    // remote note played on arrival puts socket jitter and main-thread load straight into the audio.
    const delay = isRemote ? (delayMs ?? PLAYOUT_DELAY_MS) / 1000 : 0;
    const when = Tone.now() + delay;

    // Route to correct voice
    if (isRemote && peerId) {
      const peerVol = this.getOrCreatePeerGain(peerId).gain.value;
      const kit = this.peerKits.get(peerId);
      if (kit) {
        kit.trigger(pitch, when, normalizedVelocity * peerVol);
        return; // a drum is a one-shot: no release, no active-note bookkeeping
      }
      this.getOrCreatePeerSynth(peerId).triggerAttack(pitch, when, normalizedVelocity * peerVol);
    } else {
      if (this.localKit) {
        this.localKit.trigger(pitch, when, normalizedVelocity);
        return;
      }
      this.synth?.triggerAttack(pitch, when, normalizedVelocity);
    }

    const releaseTimer = setTimeout(() => {
      this.releaseNote(pitch, peerId);
    }, MAX_NOTE_HOLD_S * 1000);

    const existing = this.activeNotes.get(key);
    if (existing) clearTimeout(existing.releaseTimer);
    this.activeNotes.set(key, { releaseTimer });
  }

  /** Release a note (optionally scoped to peerId) */
  releaseNote(pitch: string, peerId?: string): void {
    // The guard has to ask about the voice that will be released: with Drums chosen locally there is
    // no melodic synth, and this returned early for every peer's note_off, leaving their notes ringing.
    if (peerId ? !this.peerSynths.has(peerId) && !this.peerKits.has(peerId) : !this.synth && !this.localKit) return;
    // a drum already finished: releasing it would only cut the next hit
    if (peerId ? this.peerKits.has(peerId) : this.localKit !== null) return;

    const key = peerId ? `${peerId}:${pitch}` : pitch;
    const existing = this.activeNotes.get(key);
    if (existing) {
      clearTimeout(existing.releaseTimer);
      this.activeNotes.delete(key);
    }

    // Release on the correct synth
    if (peerId) {
      const peerSynth = this.peerSynths.get(peerId);
      if (peerSynth) {
        peerSynth.triggerRelease(pitch);
        return;
      }
    }
    this.synth?.triggerRelease(pitch);
  }

  releaseAll(): void {
    if (!this.synth) return;
    for (const [, { releaseTimer }] of this.activeNotes) {
      clearTimeout(releaseTimer);
    }
    this.activeNotes.clear();
    this.synth.releaseAll();
  }

  isStarted(): boolean {
    return this.started;
  }
}
