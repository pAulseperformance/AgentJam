import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * THE KNOB. A synth panel is not a column of sliders: a knob is read as a POSITION, and a ring of ticks
 * tells you where you are in the range before you read the number.
 *
 * Drag vertically to move it, hold shift for a tenth of the travel, press the arrow keys to nudge it,
 * double-click to return to the value the patch loaded with. All of it is one component so a control
 * behaves the same wherever it is on the panel.
 */
interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** shown under the knob; receives the value so a control can say Hz, dB or seconds */
  format?: (value: number) => string;
  /** the value a double-click returns to */
  resetTo?: number;
  disabled?: boolean;
  /** the section's accent: the ring is drawn in it, so sections read apart at a glance */
  accent?: string;
  onChange: (value: number) => void;
  /** hooks the smoke and the tests: [data-knob="<label>"] */
  testId?: string;
}

const SIZE = 46;
const SWEEP = 270; // degrees of travel, the way a hardware knob is cut

export function Knob({
  label,
  value,
  min,
  max,
  step = (max - min) / 200,
  format,
  resetTo,
  disabled,
  accent = 'currentColor',
  onChange,
  testId,
}: KnobProps) {
  const dragging = useRef<{ startY: number; startValue: number } | null>(null);
  const [active, setActive] = useState(false);

  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max]);
  const snapped = useCallback((next: number) => {
    const stepped = Math.round((next - min) / step) * step + min;
    return clamp(Number(stepped.toFixed(6)));
  }, [clamp, min, step]);

  const commit = useCallback((next: number) => {
    if (disabled) return;
    onChange(snapped(next));
  }, [disabled, onChange, snapped]);

  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      const dy = drag.startY - event.clientY;
      // 200 px of travel is the full range, a tenth of that with shift held
      const scale = (max - min) / 200 * (event.shiftKey ? 0.1 : 1);
      commit(drag.startValue + dy * scale);
    };
    const up = () => { dragging.current = null; setActive(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active, commit, max, min]);

  const ratio = (value - min) / (max - min || 1);
  const angle = -SWEEP / 2 + ratio * SWEEP;
  const radius = SIZE / 2 - 5;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const arcStart = -SWEEP / 2;
  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [sx, sy] = polar(arcStart, radius);
  const [ex, ey] = polar(angle, radius);
  const largeArc = angle - arcStart > 180 ? 1 : 0;

  return (
    <div className={`knob ${disabled ? 'knob--off' : ''}`} data-knob={testId ?? label.toLowerCase()}>
      <svg
        width={SIZE}
        height={SIZE}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        data-patch={testId ?? label.toLowerCase()}
        aria-valuetext={format ? format(value) : String(value)}
        style={{ cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none' }}
        onPointerDown={event => {
          if (disabled) return;
          dragging.current = { startY: event.clientY, startValue: value };
          setActive(true);
          (event.target as Element).setPointerCapture?.(event.pointerId);
        }}
        onDoubleClick={() => commit(resetTo ?? value)}
        onKeyDown={event => {
          const big = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); commit(value + step * big); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); commit(value - step * big); }
          if (event.key === 'Home') { event.preventDefault(); commit(min); }
          if (event.key === 'End') { event.preventDefault(); commit(max); }
        }}
      >
        <circle cx={cx} cy={cy} r={radius + 3} fill="rgba(255,255,255,0.05)" stroke="var(--border)" strokeWidth="1" />
        {/* the travel, then the part travelled: two arcs, so the ring reads as a gauge */}
        <path d={`M${sx},${sy} A${radius},${radius} 0 1 1 ${polar(SWEEP / 2, radius)[0]},${polar(SWEEP / 2, radius)[1]}`}
          fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" strokeLinecap="round" />
        <path d={`M${sx},${sy} A${radius},${radius} 0 ${largeArc} 1 ${ex},${ey}`}
          fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
        {/* the pointer: the one line that makes a knob a knob */}
        <line
          x1={cx}
          y1={cy}
          x2={polar(angle, radius - 4)[0]}
          y2={polar(angle, radius - 4)[1]}
          stroke={accent}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="2.2" fill={accent} />
      </svg>
      <span className="knob__label">{label}</span>
      <span className="knob__value">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}
