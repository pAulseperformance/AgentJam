import type { MetricsSnapshot } from '@/shared/protocol';
import { useState, useCallback } from 'react';

interface MetricsPanelProps {
  metrics: MetricsSnapshot | null;
  /** Client-measured WS round-trip time in ms */
  wsRtt: number | null;
  /** Client SNTP clock offset in ms */
  clockOffset: number | null;
}

/**
 * MetricsPanel — collapsible dashboard showing live performance stats.
 * TAS-106: SNTP drift, WS RTT, notes/sec, peer latencies.
 */
export function MetricsPanel({ metrics, wsRtt, clockOffset }: MetricsPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <div className={`metrics-panel ${collapsed ? 'metrics-panel--collapsed' : ''}`}>
      <button
        className="metrics-panel__toggle"
        onClick={toggleCollapsed}
      >
        📊 Metrics {collapsed ? '▸' : '▾'}
        {!collapsed && metrics && (
          <span className="metrics-panel__summary">
            {metrics.peerCount} peers · {metrics.totalNotesPerSec} n/s
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="metrics-panel__body">
          {/* Quick stats row */}
          <div className="metrics-panel__row">
            <MetricCard
              label="Peers"
              value={metrics?.peerCount ?? 0}
              unit=""
            />
            <MetricCard
              label="Agents"
              value={metrics?.agentCount ?? 0}
              unit=""
            />
            <MetricCard
              label="Notes/s"
              value={metrics?.totalNotesPerSec ?? 0}
              unit=""
            />
          </div>

          {/* Network stats */}
          <div className="metrics-panel__row">
            <MetricCard
              label="WS RTT"
              value={wsRtt ?? 0}
              unit="ms"
              threshold={100}
            />
            <MetricCard
              label="Clock Offset"
              value={clockOffset ?? 0}
              unit="ms"
              threshold={10}
            />
            <MetricCard
              label="Uptime"
              value={metrics ? Math.floor(metrics.uptimeMs / 1000) : 0}
              unit="s"
            />
          </div>

          {/* Per-peer breakdown */}
          {metrics && metrics.peerMetrics.length > 0 && (
            <div className="metrics-panel__peers">
              <h4 className="metrics-panel__subtitle">Per-peer</h4>
              {metrics.peerMetrics.map(pm => (
                <div key={pm.peerId} className="metrics-panel__peer-row">
                  <span className="metrics-panel__peer-id">
                    {pm.peerId.slice(0, 8)}
                  </span>
                  <span className="metrics-panel__peer-stat">
                    {pm.notesPerSec} n/s
                  </span>
                  <span className="metrics-panel__peer-stat">
                    {pm.activeNoteCount} active
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: number;
  unit: string;
  /** If value exceeds threshold, show warning color */
  threshold?: number;
}

function MetricCard({ label, value, unit, threshold }: MetricCardProps) {
  const isWarning = threshold !== undefined && Math.abs(value) > threshold;

  return (
    <div className={`metric-card ${isWarning ? 'metric-card--warning' : ''}`}>
      <span className="metric-card__value">
        {typeof value === 'number' ? Math.round(value) : value}
        {unit && <small className="metric-card__unit">{unit}</small>}
      </span>
      <span className="metric-card__label">{label}</span>
    </div>
  );
}
