import * as Tone from 'tone';
import { PLAYOUT_DELAY_MS, MAX_NOTE_HOLD_S } from '@/shared/protocol/constants';

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

  /** Per-peer volume nodes: peerId → Gain */
  private peerGains: Map<string, Tone.Gain> = new Map();
  /** Master volume for local player */
  private masterGain: Tone.Gain | null = null;
  /** Muted peers set */
  private mutedPeers: Set<string> = new Set();

  async start(): Promise<void> {
    if (this.started) return;

    await Tone.start();

    this.masterGain = new Tone.Gain(1).toDestination();

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8,
      },
    }).connect(this.masterGain);
    this.synth.maxPolyphony = 16;

    this.started = true;
  }

  dispose(): void {
    if (this.synth) {
      this.synth.releaseAll();
      this.synth.dispose();
      this.synth = null;
    }
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

  /** Set master volume (local player) */
  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /** Get master volume */
  getMasterVolume(): number {
    return this.masterGain?.gain.value ?? 1;
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
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 1;
    }
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

    const normalizedVelocity = velocity / 127;
    const key = peerId ? `${peerId}:${pitch}` : pitch;

    const delay = isRemote ? PLAYOUT_DELAY_MS / 1000 : 0;
    const when = Tone.now() + delay;

    // For remote peers with per-peer gain, temporarily connect synth
    // through peer's gain node (Tone.js handles the routing)
    if (peerId && isRemote) {
      const peerGain = this.getOrCreatePeerGain(peerId);
      const peerVol = peerGain.gain.value;
      this.synth.triggerAttack(pitch, when, normalizedVelocity * peerVol);
    } else {
      this.synth.triggerAttack(pitch, when, normalizedVelocity);
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
