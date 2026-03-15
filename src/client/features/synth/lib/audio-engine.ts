import * as Tone from 'tone';
import { PLAYOUT_DELAY_MS, MAX_NOTE_HOLD_S } from '@/shared/protocol/constants';

// ── Instrument Definitions ────────────────────────────────────────────────

export type InstrumentType = 'PolySynth' | 'AMSynth' | 'FMSynth' | 'MembraneSynth' | 'PluckSynth';

export const INSTRUMENT_LIST: { value: InstrumentType; label: string; icon: string }[] = [
  { value: 'PolySynth', label: 'Classic', icon: '🎹' },
  { value: 'AMSynth', label: 'AM Synth', icon: '🔔' },
  { value: 'FMSynth', label: 'FM Synth', icon: '🎸' },
  { value: 'MembraneSynth', label: 'Drums', icon: '🥁' },
  { value: 'PluckSynth', label: 'Pluck', icon: '🪕' },
];

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
      // PluckSynth can't be used in PolySynth — create a PolySynth with pluck-like settings
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
 * AudioEngine — Vanilla TypeScript class (NOT a React hook).
 *
 * v5 Pattern: This class operates entirely outside React's lifecycle.
 * It is created once and accessed via ref — note events from the WebSocket
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

  /** Per-peer synth instances keyed by peerId — different instruments per peer */
  private peerSynths: Map<string, Tone.PolySynth> = new Map();
  /** Per-peer instrument type tracking */
  private peerInstruments: Map<string, InstrumentType> = new Map();
  /** Per-peer volume nodes: peerId → Gain */
  private peerGains: Map<string, Tone.Gain> = new Map();
  /** Master volume for local player */
  private masterGain: Tone.Gain | null = null;
  /** Muted peers set */
  private mutedPeers: Set<string> = new Set();
  /** Master volume as a plain number (0-1) — applied as velocity multiplier */
  private masterVolumeLevel = 1;
  private masterMutedState = false;

  async start(): Promise<void> {
    if (this.started) return;

    await Tone.start();

    this.masterGain = new Tone.Gain(1).toDestination();
    this.synth = createInstrumentSynth(this.currentInstrument, this.masterGain);
    this.synth.maxPolyphony = 16;

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
  private getOrCreatePeerGain(peerId: string): Tone.Gain {
    let gain = this.peerGains.get(peerId);
    if (!gain) {
      gain = new Tone.Gain(1).toDestination();
      this.peerGains.set(peerId, gain);
    }
    return gain;
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

  /** Set master volume (local player) — stored as field, applied in playNote */
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
      // Restore to default volume — caller should set actual volume
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
    }
    this.synth = createInstrumentSynth(instrument, this.masterGain);
    this.synth.maxPolyphony = 16;
  }

  /** Get current instrument */
  getInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  /** Set the instrument for a remote peer */
  setPeerInstrument(peerId: string, instrument: InstrumentType): void {
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
  playNote(pitch: string, velocity: number, isRemote: boolean, peerId?: string): void {
    if (!this.synth) return;

    // If this is a muted peer, skip entirely
    if (peerId && this.mutedPeers.has(peerId)) return;
    // If local and master is muted, skip
    if (!isRemote && this.masterMutedState) return;

    const normalizedVelocity = velocity / 127;
    const key = peerId ? `${peerId}:${pitch}` : pitch;

    const delay = isRemote ? PLAYOUT_DELAY_MS / 1000 : 0;
    const when = Tone.now() + delay;

    // Route to correct synth instance
    if (peerId && isRemote) {
      // Remote peer: use peer-specific synth (instrument-aware)
      const peerSynth = this.getOrCreatePeerSynth(peerId);
      const peerGain = this.getOrCreatePeerGain(peerId);
      const peerVol = peerGain.gain.value;
      peerSynth.triggerAttack(pitch, when, normalizedVelocity * peerVol);
    } else {
      // Local notes: use local synth with master volume
      this.synth.triggerAttack(pitch, when, normalizedVelocity * this.masterVolumeLevel);
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
    if (!this.synth) return;

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
    this.synth.triggerRelease(pitch);
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
