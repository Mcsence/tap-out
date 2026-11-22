import { useEffect, useRef, useState } from 'react';

/** Les 8 sommets d'un octogone régulier dans un carré de `size`, avec une marge `inset`. */
export function octagonPoints(size: number, inset = 0): string {
  const s = size - inset * 2;
  const k = s * 0.2929; // 1 - 1/√2 : longueur du coin coupé
  const o = inset;
  return [
    [o + k, o],
    [o + s - k, o],
    [o + s, o + k],
    [o + s, o + s - k],
    [o + s - k, o + s],
    [o + k, o + s],
    [o, o + s - k],
    [o, o + k],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

/** Décor de fond : octogones concentriques et lumières d'arène. */
export function OctagonBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`backdrop ${className}`} aria-hidden="true">
      <svg className="backdrop-octagons" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <polygon points={octagonPoints(100, 1)} className="ring ring-1" />
        <polygon points={octagonPoints(100, 9)} className="ring ring-2" />
        <polygon points={octagonPoints(100, 17)} className="ring ring-3" />
        <polygon points={octagonPoints(100, 25)} className="ring ring-4" />
      </svg>
    </div>
  );
}

interface TimerProps {
  /** Instant (performance.now) où le chrono atteint 0. */
  deadline: number;
  durationMs: number;
  /** Chrono figé (réponse révélée) : on affiche la valeur au moment du gel. */
  frozen?: boolean;
  onExpire?: () => void;
}

/** Chrono en forme d'octogone : le contour rouge se vide à mesure que le temps passe. */
export function OctagonTimer({ deadline, durationMs, frozen = false, onExpire }: TimerProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - performance.now()));
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    expired.current = false;
    if (frozen) return;
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, deadline - performance.now());
      setRemaining(left);
      if (left <= 0) {
        if (!expired.current) {
          expired.current = true;
          onExpireRef.current?.();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, frozen]);

  const seconds = Math.ceil(remaining / 1000);
  const progress = durationMs > 0 ? remaining / durationMs : 0;
  const danger = !frozen && seconds <= 5;

  return (
    <div
      className={`timer ${danger ? 'timer-danger' : ''} ${frozen ? 'timer-frozen' : ''}`}
      role="timer"
      aria-label={`${seconds} secondes restantes`}
    >
      <svg viewBox="0 0 120 120">
        <polygon points={octagonPoints(120, 6)} className="timer-track" />
        <polygon
          points={octagonPoints(120, 6)}
          className="timer-bar"
          pathLength={100}
          style={{ strokeDashoffset: 100 * (1 - progress) }}
        />
      </svg>
      <span key={danger ? seconds : 'calm'} className="timer-value display">
        {seconds}
      </span>
    </div>
  );
}
