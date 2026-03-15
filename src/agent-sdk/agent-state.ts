/**
 * Agent State Machine — TAS-97
 *
 * Tracks the agent's lifecycle within a jam room:
 * idle → connecting → connected → listening → generating → listening → ...
 */

export type AgentState = 'idle' | 'connecting' | 'connected' | 'listening' | 'generating';

export interface AgentTransportState {
  bpm: number;
  key: string;
  transportStartTime: number;
}

export interface AgentPeer {
  peerId: string;
  name: string;
  kind: 'human' | 'agent';
  instrument: string;
}

export interface AgentContext {
  state: AgentState;
  peerId: string | null;
  transport: AgentTransportState;
  peers: Map<string, AgentPeer>;
  clockOffset: number;
  /** Active notes heard from all peers in current measure window */
  noteBuffer: AgentNoteRecord[];
  /** Measure counter — how many measures since agent connected */
  measureCount: number;
  /** Last generation timestamp — for rate limiting */
  lastGenerationTime: number;
}

export interface AgentNoteRecord {
  peerId: string;
  pitch: string;
  beatTime: number;
  velocity: number;
  type: 'note_on' | 'note_off';
  timestamp: number;
}

/**
 * Creates a fresh agent context with default values.
 */
export function createAgentContext(): AgentContext {
  return {
    state: 'idle',
    peerId: null,
    transport: { bpm: 120, key: 'C major', transportStartTime: 0 },
    peers: new Map(),
    clockOffset: 0,
    noteBuffer: [],
    measureCount: 0,
    lastGenerationTime: 0,
  };
}

/**
 * State transition validator — ensures only valid transitions occur.
 */
export function canTransition(from: AgentState, to: AgentState): boolean {
  const validTransitions: Record<AgentState, AgentState[]> = {
    idle: ['connecting'],
    connecting: ['connected', 'idle'],        // idle on failure
    connected: ['listening', 'idle'],          // idle on disconnect
    listening: ['generating', 'idle'],         // start gen or disconnect
    generating: ['listening', 'idle'],         // back to listening or disconnect
  };
  return validTransitions[from].includes(to);
}

/**
 * Transition the agent state with validation.
 * Returns true if transition was valid, false otherwise.
 */
export function transition(ctx: AgentContext, to: AgentState): boolean {
  if (!canTransition(ctx.state, to)) {
    console.warn(`[AgentState] Invalid transition: ${ctx.state} → ${to}`);
    return false;
  }
  ctx.state = to;
  return true;
}
