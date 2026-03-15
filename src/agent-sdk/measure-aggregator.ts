import type { AgentContext, AgentNoteRecord } from './agent-state';

/**
 * Structured context for LLM music generation — TAS-98
 *
 * Extracts the last N measures of notes into a bounded, structured
 * format that fits within an LLM's context window.
 */

export interface AgentMusicContext {
  /** Current room BPM */
  bpm: number;
  /** Current room key */
  key: string;
  /** Total measures elapsed */
  measureNumber: number;
  /** How many peers are currently playing */
  activePeerCount: number;
  /** Detected chord/scale from recent notes */
  harmonicSummary: string;
  /** Recent notes grouped by peer — last 2-4 measures */
  recentNotes: PeerNoteSummary[];
}

export interface PeerNoteSummary {
  peerId: string;
  name: string;
  kind: 'human' | 'agent';
  notes: SimpleNote[];
}

export interface SimpleNote {
  pitch: string;
  beatTime: number;
  velocity: number;
}

/**
 * Extract pitch class from note string (e.g., "C4" → "C", "F#3" → "F#")
 */
function pitchClass(pitch: string): string {
  return pitch.replace(/\d+$/, '');
}

/**
 * Simple harmonic analysis — detect most common pitch classes
 * and estimate key/scale. Returns human-readable summary.
 */
function analyzeHarmony(notes: AgentNoteRecord[]): string {
  if (notes.length === 0) return 'silence';

  const counts = new Map<string, number>();
  for (const n of notes) {
    if (n.type !== 'note_on') continue;
    const pc = pitchClass(n.pitch);
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }

  if (counts.size === 0) return 'silence';

  // Sort by frequency
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topNotes = sorted.slice(0, 5).map(([note]) => note);

  return topNotes.join(', ') + (sorted.length > 5 ? ` (+${sorted.length - 5} more)` : '');
}

/**
 * Aggregate current agent context into a structured LLM prompt context.
 * Extracts notes from the rolling buffer (last 2-4 measures).
 */
export function aggregateMeasureContext(ctx: AgentContext): AgentMusicContext {
  const { transport, peers, noteBuffer, measureCount } = ctx;

  // Calculate time window: last 4 measures
  const measureDurationMs = (60 / transport.bpm) * 4 * 1000;
  const windowMs = measureDurationMs * 4;
  const cutoff = Date.now() - windowMs;

  // Filter to recent notes only
  const recentNotes = noteBuffer.filter(n => n.timestamp >= cutoff);

  // Group by peer
  const peerGroups = new Map<string, AgentNoteRecord[]>();
  for (const note of recentNotes) {
    const group = peerGroups.get(note.peerId) ?? [];
    group.push(note);
    peerGroups.set(note.peerId, group);
  }

  // Build peer summaries
  const peerSummaries: PeerNoteSummary[] = [];
  for (const [peerId, notes] of peerGroups) {
    const peer = peers.get(peerId);
    peerSummaries.push({
      peerId,
      name: peer?.name ?? 'Unknown',
      kind: peer?.kind ?? 'human',
      notes: notes
        .filter(n => n.type === 'note_on')
        .map(n => ({
          pitch: n.pitch,
          beatTime: n.beatTime,
          velocity: n.velocity,
        })),
    });
  }

  return {
    bpm: transport.bpm,
    key: transport.key,
    measureNumber: measureCount,
    activePeerCount: peerGroups.size,
    harmonicSummary: analyzeHarmony(recentNotes),
    recentNotes: peerSummaries,
  };
}

/**
 * Format AgentMusicContext into a prompt string for the LLM.
 */
export function formatContextForPrompt(context: AgentMusicContext): string {
  const lines: string[] = [
    `You are an AI musician in a live jam room.`,
    `BPM: ${context.bpm}, Key: ${context.key}, Measure: ${context.measureNumber}`,
    `Active peers: ${context.activePeerCount}`,
    `Harmony detected: ${context.harmonicSummary}`,
    ``,
    `Recent notes from other players:`,
  ];

  for (const peer of context.recentNotes) {
    lines.push(`  ${peer.name} (${peer.kind}):`);
    if (peer.notes.length === 0) {
      lines.push('    (silent)');
    } else {
      const noteStrs = peer.notes.slice(-16).map(
        n => `${n.pitch}@beat${n.beatTime.toFixed(2)}(v${n.velocity.toFixed(2)})`
      );
      lines.push(`    ${noteStrs.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('Generate a musical response for the next measure (4 beats).');
  lines.push('Reply with a JSON array of note objects: [{ "pitch": "C4", "beatTime": 0.0, "velocity": 0.8, "duration": 0.5 }, ...]');
  lines.push('Rules: stay in key, complement (don\'t copy) other players, use 16th-note grid (0, 0.25, 0.5, ...), max 16 notes.');

  return lines.join('\n');
}
