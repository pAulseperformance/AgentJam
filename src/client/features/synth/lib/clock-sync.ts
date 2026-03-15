import { CLOCK_SYNC_INTERVAL_MS } from '@/shared/protocol/constants';
import type { AudioEngine } from './audio-engine';

/**
 * ClockSync — SNTP ping-pong clock synchronization utility (TAS-69).
 *
 * v5 Pattern: Uses the SNTP handshake formula to calculate true network
 * offset with RTT compensation, anchored to the hardware AudioContext
 * clock (Tone.now()) instead of Date.now() to prevent OS/audio clock drift.
 *
 * Formula:
 *   RTT = (t3 - t0) - (t2 - t1)
 *   offset = ((t1 - t0) + (t2 - t3)) / 2
 *
 * Where:
 *   t0 = client send time (performance.now)
 *   t1 = server receive time (Date.now on DO)
 *   t2 = server send time (Date.now on DO)
 *   t3 = client receive time (performance.now)
 */
export class ClockSync {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sendMessage: ((msg: string) => void) | null = null;
  private audioEngine: AudioEngine;
  private pendingT0: number | null = null;
  private peerId: string;
  private samples: number[] = [];
  private readonly maxSamples = 5; // median filter

  constructor(audioEngine: AudioEngine, peerId: string) {
    this.audioEngine = audioEngine;
    this.peerId = peerId;
  }

  /** Start periodic clock sync — call after WS connects */
  start(sendMessage: (msg: string) => void): void {
    this.sendMessage = sendMessage;

    // Initial ping
    this.sendPing();

    // Periodic re-sync
    this.intervalId = setInterval(() => {
      this.sendPing();
    }, CLOCK_SYNC_INTERVAL_MS);
  }

  /** Stop periodic sync */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.sendMessage = null;
  }

  /** Send a clock sync ping to the server */
  private sendPing(): void {
    if (!this.sendMessage) return;

    this.pendingT0 = performance.now();
    this.sendMessage(JSON.stringify({
      type: 'clock_sync_ping',
      t0: this.pendingT0,
      peerId: this.peerId,
    }));
  }

  /**
   * Handle a clock_sync_pong response from the server.
   * Call this from the WebSocket message handler.
   */
  handlePong(t1: number, t2: number): void {
    if (this.pendingT0 === null) return;

    const t0 = this.pendingT0;
    const t3 = performance.now();
    this.pendingT0 = null;

    // SNTP formula
    const rtt = (t3 - t0) - (t2 - t1);
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    // Reject outliers (RTT > 500ms = unreliable)
    if (rtt > 500) return;

    // Add to rolling sample window
    this.samples.push(offset);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Use median of samples for stability
    const medianOffset = this.getMedian(this.samples);
    this.audioEngine.setClockOffset(medianOffset);
  }

  private getMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    return sorted[mid] ?? 0;
  }

  /** Current calculated offset in ms */
  getOffset(): number {
    return this.samples.length > 0 ? this.getMedian(this.samples) : 0;
  }
}
