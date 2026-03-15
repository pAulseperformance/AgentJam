import * as Tone from 'tone';
import { PLAYOUT_DELAY_MS, MAX_NOTE_HOLD_S } from '@/shared/protocol/constants';

/**
 * AudioEngine — Vanilla TypeScript class (NOT a React hook).
 *
 * v5 Pattern: This class operates entirely outside React's lifecycle.
 * It is created once and accessed via ref — note events from the WebSocket
 * are routed directly here without triggering React re-renders.
 *
 * Responsibilities:
 * - Manage Tone.js PolySynth lifecycle
 * - Schedule note_on/note_off events with playout delay
 * - Provide AudioContext reference for clock anchoring
 * - Track active notes for safety release (MAX_NOTE_HOLD_S)
 */
export class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private activeNotes: Map<string, { releaseTimer: ReturnType<typeof setTimeout> }> = new Map();
  private clockOffset = 0; // SNTP-calculated offset (set by ClockSync)
  private started = false;

  /**
   * Initialize the audio context — must be called from a user gesture.
   * This satisfies the browser's autoplay policy.
   */
  async start(): Promise<void> {
    if (this.started) return;

    await Tone.start();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8,
      },
    }).toDestination();
    this.synth.maxPolyphony = 16;

    this.started = true;
  }

  /** Dispose of all audio resources */
  dispose(): void {
    if (this.synth) {
      this.synth.releaseAll();
      this.synth.dispose();
      this.synth = null;
    }
    for (const [, { releaseTimer }] of this.activeNotes) {
      clearTimeout(releaseTimer);
    }
    this.activeNotes.clear();
    this.started = false;
  }

  /** Get the current Tone.js transport time — used for clock anchoring */
  getToneNow(): number {
    return Tone.now();
  }

  /** Get the raw AudioContext for SNTP anchoring */
  getAudioContext(): AudioContext | null {
    return Tone.getContext().rawContext as AudioContext | null;
  }

  /** Set SNTP clock offset (called by ClockSync) */
  setClockOffset(offset: number): void {
    this.clockOffset = offset;
  }

  /** Get the network-adjusted time anchored to AudioContext */
  getNetworkTime(): number {
    return Tone.now() + this.clockOffset;
  }

  /**
   * Play a note — used for BOTH local input and remote peer notes.
   *
   * For local input: beatTime = Tone.now() (instant playback)
   * For remote peers: beatTime = network-adjusted time + PLAYOUT_DELAY_MS
   */
  playNote(pitch: string, velocity: number, isRemote: boolean): void {
    if (!this.synth) return;

    const normalizedVelocity = velocity / 127;
    const key = pitch; // unique key for active note tracking

    // Schedule with playout delay for remote notes
    const delay = isRemote ? PLAYOUT_DELAY_MS / 1000 : 0;
    const when = Tone.now() + delay;

    this.synth.triggerAttack(pitch, when, normalizedVelocity);

    // Safety: auto-release after MAX_NOTE_HOLD_S
    const releaseTimer = setTimeout(() => {
      this.releaseNote(pitch);
    }, MAX_NOTE_HOLD_S * 1000);

    // Clear previous timer if note is re-triggered
    const existing = this.activeNotes.get(key);
    if (existing) clearTimeout(existing.releaseTimer);

    this.activeNotes.set(key, { releaseTimer });
  }

  /** Release a note */
  releaseNote(pitch: string): void {
    if (!this.synth) return;

    const key = pitch;
    const existing = this.activeNotes.get(key);
    if (existing) {
      clearTimeout(existing.releaseTimer);
      this.activeNotes.delete(key);
    }

    this.synth.triggerRelease(pitch);
  }

  /** Release all notes — MIDI panic */
  releaseAll(): void {
    if (!this.synth) return;

    for (const [, { releaseTimer }] of this.activeNotes) {
      clearTimeout(releaseTimer);
    }
    this.activeNotes.clear();
    this.synth.releaseAll();
  }

  /** Whether the audio context has been started */
  isStarted(): boolean {
    return this.started;
  }
}
