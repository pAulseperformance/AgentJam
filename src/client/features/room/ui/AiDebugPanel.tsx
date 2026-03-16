import { useState } from 'react';

/** Matches the AiCallMeta shape from the server */
interface AiDebugEntry {
  agentPeerId: string;
  agentName: string;
  meta: {
    source: 'llm' | 'pattern' | 'fallback';
    model: string;
    prompt: string;
    response: string;
    noteCount: number;
    latencyMs: number;
    error?: string;
  };
}

const AI_MODELS = [
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B' },
  { id: '@cf/google/gemma-7b-it-lora', label: 'Gemma 7B' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2-lora', label: 'Mistral 7B' },
];

interface AiDebugPanelProps {
  entries: AiDebugEntry[];
  onModelChange: (agentPeerId: string, model: string) => void;
}

/**
 * AI Observability Panel — shows what each agent's LLM is "thinking."
 * Displays prompt, response, latency, source (llm/pattern/fallback),
 * model selector per agent.
 */
export function AiDebugPanel({ entries, onModelChange }: AiDebugPanelProps) {
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
                  {AI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  <option value="none">Pattern Generator (no AI)</option>
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
