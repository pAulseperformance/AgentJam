// Room feature — Public API
export { useRoomSocket } from './hooks/use-room-socket';
export { PeerList } from './ui/PeerList';
export { TransportBar } from './ui/TransportBar';
export { AgentPanel } from './ui/AgentPanel';
export { MetricsPanel } from './ui/MetricsPanel';
export { AiDebugPanel } from './ui/AiDebugPanel';
export { SessionPanel } from './ui/session-panel';
// THE TEMPO MARK and the records it reads: the page draws the ceiling under the transport control,
// so these two are part of the feature's public API rather than a second copy of the math in the page.
export { tempoMarkOf, type TempoMark } from './lib/session-summary';
export { sessionSnapshot } from './lib/session-recorder';
