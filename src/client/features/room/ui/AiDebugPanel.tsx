import { useState } from 'react';
import { NO_MODEL, selectableModels } from '@/shared/ai/models';

/** Matches the AiCallMeta shape from the server */
interface AiDebugEntry {
  agentPeerId: string;
  agentName: string;
  tier?: 'public' | 'signed';
  meta: {
    source: 'llm' | 'pattern' | 'fallback' | 'rest';
    tier?: 'public' | 'signed';
    model: string;
    /** 'jev' when the measure was judged before it was rendered */
    decider?: 'jev' | 'none';
    brief?: { density: string; register: string; play: boolean; latencyMs: number } | null;
    prompt: string;
    response: string;
    noteCount: number;
    latencyMs: number;
    error?: string;
  };
}

interface AiDebugPanelProps {
  entries: AiDebugEntry[];
  /** the same answer the server used: which models this viewer may select */
  signedIn?: boolean;
  onModelChange: (agentPeerId: string, model: string) => void;
}

/**
 * AI Observability Panel, shows what each agent's LLM is "thinking."
 * Displays prompt, response, latency, source (llm/pattern/fallback),
 * model selector per agent.
 */
export function AiDebugPanel({ entries, signedIn = false, onModelChange }: AiDebugPanelProps) {
  const models = selectableModels(signedIn);
  const [expanded, setExpanded] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  if (entries.length === 0) return null;

  // Group by agent, keep only latest entry per agent
  const latest = new Map<string, AiDebugEntry>();
  for (const e of entries) {
    latest.set(e.agentPeerId, e);
  }

  const agents = Array.from(latest.values());
  const active = selectedAgent ? latest.get(selectedAgent) : agents[0];

  const sourceColor = (s: string) => {
    if (s === 'llm') return 'var(--accent-emerald)';
    if (s === 'rest') return 'var(--accent-amber)';
    if (s === 'pattern') return 'var(--accent-indigo)';
    return 'var(--accent-rose)';
  };

  return (
    <section className="ai-debug-panel" aria-label="AI Observability">
      <button
        className="ai-debug-panel__toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        🧠 AI Debug {expanded ? '▼' : '▶'}
      </button>

      {expanded && (
        <div className="ai-debug-panel__body">
          {/* Agent tabs */}
          <div className="ai-debug-panel__tabs">
            {agents.map(a => (
              <button
                key={a.agentPeerId}
                className={`ai-debug-panel__tab${
                  (selectedAgent ?? agents[0]?.agentPeerId) === a.agentPeerId
                    ? ' ai-debug-panel__tab--active' : ''
                }`}
                onClick={() => setSelectedAgent(a.agentPeerId)}
              >
                🤖 {a.agentName}
              </button>
            ))}
          </div>

          {active && (
            <div className="ai-debug-panel__detail">
              {/* Status row */}
              <div className="ai-debug-panel__row">
                <span
                  className="ai-debug-panel__badge"
                  style={{ background: sourceColor(active.meta.source) }}
                >
                  {active.meta.source.toUpperCase()}
                </span>
                <span className="ai-debug-panel__stat">
                  {active.meta.latencyMs}ms
                </span>
                <span className="ai-debug-panel__stat">
                  {active.meta.noteCount} notes
                </span>
                {active.meta.decider === 'jev' && active.meta.brief && (
                  <span
                    className="ai-debug-panel__stat"
                    title="Jev judged this measure before the model rendered it"
                  >
                    🧭 jev · {active.meta.brief.density}/{active.meta.brief.register} · {active.meta.brief.latencyMs}ms
                  </span>
                )}
                {active.meta.error && (
                  <span className="ai-debug-panel__error">⚠ {active.meta.error}</span>
                )}
              </div>

              {/* Model selector */}
              <div className="ai-debug-panel__model-row">
                <label htmlFor={`model-${active.agentPeerId}`} className="ai-debug-panel__label">
                  Model:
                </label>
                <select
                  id={`model-${active.agentPeerId}`}
                  className="ai-debug-panel__select"
                  value={active.meta.model}
                  onChange={(e) => onModelChange(active.agentPeerId, e.target.value)}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.measuredMs}ms
                    </option>
                  ))}
                  <option value={NO_MODEL}>Pattern Generator (no AI)</option>
                </select>
              </div>

              {/* Prompt */}
              <details className="ai-debug-panel__section">
                <summary>📤 Prompt</summary>
                <pre className="ai-debug-panel__code">{active.meta.prompt}</pre>
              </details>

              {/* Response */}
              <details className="ai-debug-panel__section" open>
                <summary>📥 Response</summary>
                <pre className="ai-debug-panel__code">{active.meta.response}</pre>
              </details>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
