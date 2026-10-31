import { useMemo, type CSSProperties } from 'react';
import { sessionSnapshot } from '../lib/session-recorder';
import { summarize, type SessionSummary, type SummaryChip } from '../lib/session-summary';

interface SessionPanelProps {
  /**
   * The page's own `whoami` answer, the same one `AiDebugPanel` takes. `null` or `undefined` means
   * the page has not answered yet, and the panel draws nothing rather than calling a signed-in
   * listener a guest for one frame.
   */
  signedIn: boolean | null | undefined;
  /**
   * THE TRIGGER. The recorder keeps a module-level array with no change event and no subscription, so
   * calling `sessionSnapshot()` only on mount would draw the empty state forever. The socket hands
   * this panel the same `aiDebugEntries` state it hands `AiDebugPanel`, which is a fresh array on
   * every `ai_debug` message — one per bar record — so the memo below re-reads the recorder once per
   * bar. Not once per render: the array identity is the dependency.
   */
  entries: unknown[];
}

const SOURCE_BACKGROUND: Record<string, string> = {
  // the same four-source map AiDebugPanel already paints (llm emerald, rest amber, pattern indigo,
  // fallback rose). `cell` and an unknown source take a neutral: a source is not a state, and inventing
  // a fifth accent here would be a second palette for the same room.
  llm: 'var(--accent-emerald)',
  rest: 'var(--accent-amber)',
  pattern: 'var(--accent-indigo)',
  fallback: 'var(--accent-rose)',
};

function chipStyle(chip: SummaryChip): CSSProperties {
  return {
    width: 10,
    height: 22,
    borderRadius: 2,
    background: SOURCE_BACKGROUND[chip.source] ?? 'var(--text-muted)',
    // a failed chip is marked, not merely tinted: the outline survives on any fill, and the chip's
    // own title says which bar and which reason
    border: chip.failed ? '1px solid var(--text-primary)' : '1px solid transparent',
  };
}

const card: CSSProperties = {
  width: '100%',
  marginTop: 16,
  padding: '14px 16px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
};

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
};

const number: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text-primary)',
};

function rows(summary: SessionSummary) {
  if (summary.rows.length === 0) return null;
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', margin: '10px 0 0' }}>
      {summary.rows.map((row) => (
        <div key={row.key} style={{ display: 'contents' }}>
          <dt style={{ color: row.alert ? 'var(--accent-rose)' : 'var(--text-secondary)', fontSize: 14 }}>{row.key}</dt>
          <dd
            style={{
              ...number,
              margin: 0,
              fontSize: 14,
              textAlign: 'right',
              color: row.alert ? 'var(--accent-rose)' : 'var(--text-primary)',
            }}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * THE SESSION PANEL. What the last session actually sounded like: how many bars the model wrote, how
 * many it sat out, how many the generator filled, how slow the renders were and what fell back.
 *
 * Retrospective on purpose. It reads the recorder, not the socket, so it has nothing to say about the
 * next bar; the live surface stays at the top of the page. Five states, picked by
 * `summarize().state`, and every one of them is labelled in words rather than by colour.
 *
 * No class names and no stylesheet: the card's file list does not include `index.css`, so the panel
 * carries its own inline styles and takes the app's theme variables by name (`--bg-surface`,
 * `--border`, `--text-secondary`, `--radius-md`, `--font-mono`) instead of loading a sheet.
 */
export function SessionPanel({ signedIn, entries }: SessionPanelProps) {
  // The memo is before the early return so the hook order never changes. `entries` is the trigger
  // (see the prop's comment); `signedIn` is the tier.
  const summary = useMemo(
    () => summarize({ ...sessionSnapshot(), signedIn: signedIn ?? false }),
    [signedIn, entries],
  );

  if (signedIn === null || signedIn === undefined) return null;

  return (
    <section
      className="session-panel"
      data-state={summary.state}
      aria-label="Last session"
      style={card}
    >
      <div style={head}>
        <span style={{ fontWeight: 600, letterSpacing: '0.01em' }}>Last session</span>
        {/* sentence case, not the artifact's all-caps tag: the tag's job is to state the length and
            tempo in words, and it already does */}
        <span style={{ ...number, fontSize: 12, color: 'var(--text-secondary)' }}>{summary.tag}</span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
        state: {summary.stateLabel}
      </p>

      {rows(summary)}

      {summary.chips.length > 0 && (
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 10 }} role="list">
          {summary.chips.map((chip) => (
            <i
              key={chip.bar}
              role="listitem"
              title={chip.title}
              style={{ ...chipStyle(chip), display: 'block' }}
            />
          ))}
        </div>
      )}

      {summary.legend && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>{summary.legend}</p>
      )}

      <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '10px 0 0' }}>{summary.sentence}</p>

      {summary.unit && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>{summary.unit}</p>
      )}
    </section>
  );
}
