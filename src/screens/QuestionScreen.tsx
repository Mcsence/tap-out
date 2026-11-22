import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_LABEL, LEVEL_LABEL, type MatchSnapshot } from '../../shared/protocol';
import { OctagonTimer } from '../components/Octagon';
import { socket } from '../lib/socket';

const KEYS = ['A', 'B', 'C', 'D'];
const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const NUMPAD_CODES = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];

const fmt = (n: number) => n.toLocaleString('fr-FR');

/** Touche → réponse : 1 à 4 (rangée du haut ou pavé numérique, AZERTY compris) ou A à D. */
function choiceFromKey(e: KeyboardEvent): number | null {
  const byCode = Math.max(DIGIT_CODES.indexOf(e.code), NUMPAD_CODES.indexOf(e.code));
  if (byCode >= 0) return byCode;
  const byLetter = KEYS.indexOf(e.key.toUpperCase());
  return byLetter >= 0 ? byLetter : null;
}

interface Props {
  snap: MatchSnapshot;
  at: number;
  onLeave: () => void;
}

export function QuestionScreen({ snap, at, onLeave }: Props) {
  const q = snap.question!;
  const reveal = snap.reveal;
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // L'échéance du chrono est fixée à l'arrivée de la question, puis figée à la révélation.
  const deadline = useRef<number | null>(null);
  if (deadline.current === null || (snap.phase === 'question' && !reveal)) {
    deadline.current = snap.phase === 'question' ? at + snap.phaseRemainingMs : at;
  }

  const myChoice = q.myChoice ?? pending;
  const locked = myChoice !== null || !!reveal;
  const endOfRound = q.number === snap.round.questionCount;
  const nextLabel = !endOfRound
    ? 'Suivante'
    : snap.round.number === snap.round.count
      ? 'Voir le résultat'
      : 'Carte des juges';

  const choose = useCallback(
    (i: number) => {
      if (locked) return;
      setPending(i);
      setError(null);
      socket.timeout(5000).emit('answer', { seq: q.seq, choice: i }, (err, res) => {
        if (err) {
          setPending(null);
          setError("Réponse non transmise, réessaie.");
        } else if (!res.ok) {
          setError(res.error);
        }
      });
    },
    [locked, q.seq],
  );

  const next = useCallback(() => socket.emit('next'), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (!reveal) {
        const i = choiceFromKey(e);
        if (i !== null) {
          e.preventDefault();
          choose(i);
        }
      } else if (snap.kind === 'solo' && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, choose, next, snap.kind]);

  const onExpire = useCallback(() => {
    if (myChoice === null) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 700);
    }
  }, [myChoice]);

  const answerState = (i: number): string => {
    if (reveal) {
      if (i === reveal.correctIndex) return 'is-correct';
      if (i === myChoice) return 'is-wrong';
      return 'is-dim';
    }
    if (i === myChoice) return 'is-locked';
    return locked ? 'is-dim' : '';
  };

  return (
    <main className={`game ${reveal ? 'game-reveal' : ''}`}>
      <header className="hud">
        <div className="hud-block">
          <span className="label">Round</span>
          <span className="display hud-num">
            {snap.round.number}
            <small>/{snap.round.count}</small>
          </span>
          <span className="hud-sep" aria-hidden="true" />
          <span className="label">Question</span>
          <span className="display hud-num">
            {q.number}
            <small>/{snap.round.questionCount}</small>
          </span>
        </div>
        <div className="hud-block hud-topic">
          <span className={`tag level-${q.level}`}>{LEVEL_LABEL[q.level]}</span>
          <span className="label">{CATEGORY_LABEL[q.category]}</span>
        </div>
        <div className="hud-block hud-me">
          <span className="label hud-pseudo">{snap.me.pseudo}</span>
          <span className="display hud-score" key={snap.me.score}>
            {fmt(snap.me.score)}
            <small> pts</small>
          </span>
          <button
            type="button"
            className="hud-quit"
            onClick={() => {
              if (window.confirm('Abandonner la partie ?')) onLeave();
            }}
          >
            Abandonner
          </button>
        </div>
      </header>

      <section className="stage">
        <OctagonTimer deadline={deadline.current} durationMs={q.durationMs} frozen={!!reveal} onExpire={onExpire} />
        <h1 className="question-text">{q.text}</h1>
      </section>

      <ol className="answers" aria-label="Réponses">
        {q.answers.map((answer, i) => {
          const who = reveal && q.playerCount > 1 ? reveal.choices.filter((c) => c.choice === i) : [];
          return (
            <li key={i} style={{ animationDelay: `${60 + i * 50}ms` }}>
              <button
                type="button"
                className={`answer ${answerState(i)}`}
                onClick={() => choose(i)}
                disabled={locked}
                aria-pressed={myChoice === i}
              >
                <span className="answer-key display" aria-hidden="true">
                  {KEYS[i]}
                </span>
                <span className="answer-text">{answer}</span>
                {who.length > 0 && (
                  <span className="answer-who">
                    {who.map((c) => (
                      <span key={c.pseudo} className="chip">
                        {c.pseudo}
                      </span>
                    ))}
                  </span>
                )}
                {reveal && i === reveal.correctIndex && <span className="answer-mark" aria-label="Bonne réponse">✓</span>}
                {reveal && i === myChoice && i !== reveal.correctIndex && (
                  <span className="answer-mark" aria-label="Ta réponse, fausse">✕</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {reveal ? (
        <section className="reveal-panel" aria-live="polite">
          <div className={`verdict ${reveal.myCorrect ? 'verdict-win' : 'verdict-loss'}`}>
            {reveal.myCorrect ? (
              <>
                <span className="display verdict-big">+{fmt(reveal.myPoints)}</span>
                <span className="label">Bonne réponse</span>
              </>
            ) : (
              <>
                <span className="display verdict-big">{myChoice === null ? 'Trop tard' : 'Raté'}</span>
                <span className="label">0 point</span>
              </>
            )}
          </div>
          <p className="explanation">
            {reveal.explanation}
            {reveal.source && (
              <>
                {' '}
                <a href={reveal.source} target="_blank" rel="noreferrer">
                  Source
                </a>
              </>
            )}
          </p>
          <div className="next">
            <div className="next-bar" aria-hidden="true">
              <span style={{ animationDuration: `${snap.phaseRemainingMs}ms` }} />
            </div>
            {snap.kind === 'solo' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={next}>
                {nextLabel} <kbd>Entrée</kbd>
              </button>
            )}
          </div>
        </section>
      ) : (
        <footer className="game-foot">
          {error ? (
            <span className="form-error">{error}</span>
          ) : myChoice !== null ? (
            <span>
              <strong>Réponse verrouillée.</strong>
              {q.playerCount > 1 && ` ${q.answeredCount}/${q.playerCount} joueurs ont répondu.`}
            </span>
          ) : (
            <span>
              Réponds avec la souris ou les touches <kbd>1</kbd>–<kbd>4</kbd> / <kbd>A</kbd>–<kbd>D</kbd>. Pas de
              changement d'avis.
            </span>
          )}
        </footer>
      )}

      {flash && <div className="red-flash" aria-hidden="true" />}
    </main>
  );
}
