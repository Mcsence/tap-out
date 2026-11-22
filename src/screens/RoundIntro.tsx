import { LEVEL_LABEL, type MatchSnapshot } from '../../shared/protocol';

/** « ROUND 1 » plein écran, façon écran de diffusion TV. */
export function RoundIntro({ snap }: { snap: MatchSnapshot }) {
  const r = snap.round;
  const kicker = r.championship
    ? 'Championship round'
    : r.count === 1
      ? 'Round unique'
      : r.number === r.count
        ? 'Dernier round'
        : `Round ${r.number} sur ${r.count}`;

  return (
    <main className={`round-intro ${r.championship ? 'is-championship' : ''}`} aria-live="polite">
      <div className="ri-stripe" aria-hidden="true" />
      <p className="label ri-kicker">{kicker}</p>
      <h1 className="display ri-title">
        Round <span>{r.number}</span>
      </h1>
      <p className="display ri-sub">
        {r.questionCount} questions · {LEVEL_LABEL[r.level]}
      </p>
    </main>
  );
}
