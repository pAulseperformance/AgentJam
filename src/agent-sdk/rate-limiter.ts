/**
 * Rate Limiter — TAS-102
 *
 * Enforces generation constraints:
 * - Max 1 generation per 4 bars
 * - Hard 200ms timeout on LLM responses
 * - Metrics tracking for adaptive behavior
 */

export interface RateLimiterMetrics {
  totalGenerations: number;
  successfulGenerations: number;
  timeouts: number;
  skippedDueToRateLimit: number;
  avgResponseTimeMs: number;
}

export interface RateLimiterOptions {
  /** Minimum bars between generations (default: 4) */
  minBarsBetween?: number;
  /** LLM response timeout in ms (default: 200) */
  timeoutMs?: number;
  /** BPM for calculating bar duration (updated dynamically) */
  bpm?: number;
}

export class GenerationRateLimiter {
  private lastGenerationTime = 0;
  private options: Required<RateLimiterOptions>;
  private metrics: RateLimiterMetrics = {
    totalGenerations: 0,
    successfulGenerations: 0,
    timeouts: 0,
    skippedDueToRateLimit: 0,
    avgResponseTimeMs: 0,
  };
  private responseTimes: number[] = [];

  constructor(options: RateLimiterOptions = {}) {
    this.options = {
      minBarsBetween: options.minBarsBetween ?? 4,
      timeoutMs: options.timeoutMs ?? 200,
      bpm: options.bpm ?? 120,
    };
  }

  /** Update BPM (called when transport state changes) */
  setBpm(bpm: number): void {
    this.options.bpm = bpm;
  }

  /** Get the enforced timeout in ms */
  get timeoutMs(): number {
    return this.options.timeoutMs;
  }

  /**
   * Check if generation is allowed right now.
   * Returns true if enough time has passed since last generation.
   */
  canGenerate(): boolean {
    const now = Date.now();
    const barDurationMs = (60 / this.options.bpm) * 4 * 1000;
    const minIntervalMs = barDurationMs * this.options.minBarsBetween;

    if (now - this.lastGenerationTime < minIntervalMs) {
      this.metrics.skippedDueToRateLimit++;
      return false;
    }

    return true;
  }

  /**
   * Mark that a generation has started.
   * Call before invoking the LLM.
   */
  markStarted(): void {
    this.lastGenerationTime = Date.now();
    this.metrics.totalGenerations++;
  }

  /**
   * Record the result of a generation attempt.
   */
  recordResult(success: boolean, responseTimeMs: number): void {
    if (success) {
      this.metrics.successfulGenerations++;
    }
    if (responseTimeMs >= this.options.timeoutMs) {
      this.metrics.timeouts++;
    }

    // Track rolling average (last 20 responses)
    this.responseTimes.push(responseTimeMs);
    if (this.responseTimes.length > 20) {
      this.responseTimes.shift();
    }
    this.metrics.avgResponseTimeMs =
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  /** Get current metrics snapshot */
  getMetrics(): Readonly<RateLimiterMetrics> {
    return { ...this.metrics };
  }

  /**
   * Adaptive fallback: if timeout rate exceeds 50%,
   * increase the generation interval by 2x.
   */
  shouldBackOff(): boolean {
    if (this.metrics.totalGenerations < 5) return false;
    return (this.metrics.timeouts / this.metrics.totalGenerations) > 0.5;
  }
}
