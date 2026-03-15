import type { NotePlan } from './llm-planner';
import type { JamRoomAgentClient } from './agent-client';
import type { AgentContext } from './agent-state';
import { PLAYOUT_DELAY_MS } from '@/shared/protocol/constants';

/**
 * Note Scheduler — TAS-100
 *
 * Converts LLM-generated beat times into absolute timestamps,
 * applies playout delay, and schedules sending via the agent client.
 */

interface ScheduledNote {
  timer: ReturnType<typeof setTimeout>;
  pitch: string;
}

export class NoteScheduler {
  private client: JamRoomAgentClient;
  private scheduledNotes: ScheduledNote[] = [];
  private playoutDelayMs: number;

  constructor(client: JamRoomAgentClient, playoutDelayMs = PLAYOUT_DELAY_MS) {
    this.client = client;
    this.playoutDelayMs = playoutDelayMs;
  }

  /**
   * Schedule a full NotePlan for playback.
   * Converts beat times to ms delays and sends note_on / note_off events.
   */
  schedulePlan(plan: NotePlan, ctx: Readonly<AgentContext>): void {
    const { bpm } = ctx.transport;
    const beatDurationMs = (60 / bpm) * 1000;

    for (const note of plan) {
      // Calculate delay from now to when the note should sound
      const noteDelayMs = (note.beatTime * beatDurationMs) + this.playoutDelayMs;
      const durationMs = note.duration * beatDurationMs;

      // Schedule note_on
      const onTimer = setTimeout(() => {
        this.client.sendRaw(JSON.stringify({
          type: 'note_on',
          pitch: note.pitch,
          velocity: note.velocity,
          beatTime: note.beatTime,
          peerId: ctx.peerId ?? 'agent',
        }));
      }, noteDelayMs);

      this.scheduledNotes.push({ timer: onTimer, pitch: note.pitch });

      // Schedule note_off
      const offTimer = setTimeout(() => {
        this.client.sendRaw(JSON.stringify({
          type: 'note_off',
          pitch: note.pitch,
          velocity: 0,
          beatTime: note.beatTime + note.duration,
          peerId: ctx.peerId ?? 'agent',
        }));
      }, noteDelayMs + durationMs);

      this.scheduledNotes.push({ timer: offTimer, pitch: note.pitch });
    }
  }

  /**
   * Cancel all pending scheduled notes — used on disconnect or error.
   */
  cancelAll(): void {
    for (const sn of this.scheduledNotes) {
      clearTimeout(sn.timer);
    }
    this.scheduledNotes = [];
  }

  /** Number of currently scheduled note events */
  get pendingCount(): number {
    return this.scheduledNotes.length;
  }
}
