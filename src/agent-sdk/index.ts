/**
 * Agent SDK — Public API (index barrel file)
 *
 * Headless client for AI agents to connect and participate
 * as peers in AgentJam rooms.
 */

export { JamRoomAgentClient } from './agent-client';
export type { AgentClientOptions } from './agent-client';

export { createAgentContext, transition, canTransition } from './agent-state';
export type { AgentState, AgentContext, AgentNoteRecord, AgentPeer, AgentTransportState } from './agent-state';

export { aggregateMeasureContext, formatContextForPrompt } from './measure-aggregator';
export type { AgentMusicContext, PeerNoteSummary, SimpleNote } from './measure-aggregator';

export { LLMNotePlanner } from './llm-planner';
export type { PlannedNote, NotePlan, LLMPlannerOptions } from './llm-planner';

export { NoteScheduler } from './note-scheduler';

export { GenerationRateLimiter } from './rate-limiter';
export type { RateLimiterMetrics, RateLimiterOptions } from './rate-limiter';
