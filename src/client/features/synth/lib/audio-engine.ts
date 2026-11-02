import * as Tone from 'tone';
import { PLAYOUT_DELAY_MS, MAX_NOTE_HOLD_S } from '@/shared/protocol/constants';

// ── Instrument Definitions ────────────────────────────────────────────────

import { meterFromSpectrum } from './meter';

export type InstrumentType = 'PolySynth' | 'AMSynth' | 'FMSynth' | 'MembraneSynth' | 'PluckSynth' | 'DrumKit';

export const INSTRUMENT_LIST: { value: InstrumentType; label: string; icon: string }[] = [
  { value: 'PolySynth', label: 'Classic', icon: '🎹' },
  { value: 'AMSynth', label: 'AM Synth', icon: '🔔' },
  { value: 'FMSynth', label: 'FM Synth', icon: '🎸' },
  { value: 'DrumKit', label: 'Drums', icon: '🥁' },
  { value: 'PluckSynth', label: 'Pluck', icon: '🪕' },
];

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

function createInstrumentSynth(type: InstrumentType, output: Tone.InputNode): Tone.PolySynth {
  switch (type) {
    case 'AMSynth':
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 1.0 },
        modulation: { type: 'square' },
        modulationEnvelope: { attack: 0.2, decay: 0.01, sustain: 0.5, release: 0.5 },
      }).connect(output);
    case 'FMSynth':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.6 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.2, decay: 0.3, sustain: 0.2, release: 0.5 },
      }).connect(output);
    case 'MembraneSynth':
      return new Tone.PolySynth(Tone.MembraneSynth, {
        pitchDecay: 0.05,
        octaves: 4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
      }).connect(output);
    case 'PluckSynth':
      // PluckSynth can't be used in PolySynth, create a PolySynth with pluck-like settings
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.001, decay: 0.5, sustain: 0.0, release: 0.3 },
      }).connect(output);
    case 'PolySynth':
    default:
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle8' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.8 },
      }).connect(output);
  }
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
  private currentInstrument: InstrumentType = 'PolySynth';

  /** Per-peer synth instances keyed by peerId, different instruments per peer */
  private peerSynths: Map<string, Tone.PolySynth> = new Map();
  /** Per-peer drum kits: a kit is not a PolySynth, it is four one-shot voices */
  private peerKits: Map<string, DrumVoice> = new Map();
  /** The local player's kit, when they pick Drums */
  private localKit: DrumVoice | null = null;
  /** Per-peer instrument type tracking */
  private peerInstruments: Map<string, InstrumentType> = new Map();
  /** Per-peer volume nodes: peerId → Gain */
  private peerGains: Map<string, Tone.Gain> = new Map();
  /** Per-peer pan position, and the node that applies it once the voice exists */
  private peerPans: Map<string, number> = new Map();
  private peerPanners: Map<string, Tone.Panner> = new Map();
  /** Master volume for local player */
  private masterGain: Tone.Gain | null = null;
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

    this.masterGain = new Tone.Gain(1).toDestination();
    // 64 bins is enough for 16 bars and cheap enough to read every frame at 30 fps.
    this.analyser = new Tone.Analyser('fft', 128);
    this.masterGain.connect(this.analyser);
    // TWO CHANNELS, because the room now has a stereo field: every peer is panned by its seat, so a
    // goniometer and a width meter read something real instead of a mono line. The channel count is a
    // CONSTRUCTION option in Tone, not a property, so it is passed here and getValue() answers an array
    // of one buffer per channel.
    this.scope = new Tone.Analyser({ type: 'waveform', size: 512, channels: 2 });
    this.masterGain.connect(this.scope);
    if (this.currentInstrument === 'DrumKit') {
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
      this.synth.dispose();
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
      gain = new Tone.Gain(1).connect(panner);
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

  setMasterVolume(volume: number): void {
    this.masterVolumeLevel = Math.max(0, Math.min(1, volume));
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
      this.synth.dispose();
      this.synth = null;
    }
    // Switching to drums swaps the melodic synth for a kit, and back again
    if (this.localKit) { this.localKit.dispose(); this.localKit = null; }
    if (instrument === 'DrumKit') {
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
    if (synth) { synth.releaseAll(); synth.dispose(); this.peerSynths.delete(peerId); }
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

    if (instrument === 'DrumKit') {
      const existing = this.peerSynths.get(peerId);
      if (existing) { existing.releaseAll(); existing.dispose(); this.peerSynths.delete(peerId); }
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

  /** Get the synth for a remote peer, creating a default if needed */
  private getOrCreatePeerSynth(peerId: string): Tone.PolySynth {
    let synth = this.peerSynths.get(peerId);
    if (!synth) {
      const gain = this.getOrCreatePeerGain(peerId);
      synth = createInstrumentSynth('PolySynth', gain);
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
        this.localKit.trigger(pitch, when, normalizedVelocity * this.masterVolumeLevel);
        return;
      }
      this.synth?.triggerAttack(pitch, when, normalizedVelocity * this.masterVolumeLevel);
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
