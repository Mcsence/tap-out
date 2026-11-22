import { useEffect } from 'react';
import { LEVEL_LABEL, roundLevels, type MatchSnapshot } from '../../shared/protocol';
import { RankMove } from '../components/RankMove';
import { fmt } from '../lib/format';
import { socket } from '../lib/socket';

/** Entre deux rounds : le classement façon carte des juges, avec l'évolution des places. */
export function Scorecard({ snap }: { snap: MatchSnapshot }) {
  const standings = snap.standings ?? [];
  const done = snap.round.number;
  const rounds = snap.round.count;
  const nextLevel = roundLevels(snap.config)[done];
  const solo = snap.kind === 'solo';
  const judges = snap.config.scoring === 'juges';

  useEffect(() => {
    if (!solo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        socket.emit('next');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [solo]);

  return (
    <main className="scorecard-screen">
      <p className="kicker">
        <span className="kicker-bar" />
        Fin du round {done} sur {rounds}
      </p>
      <h1 className="display scorecard-title">Carte des juges</h1>

      <div className="scorecard">
        <div className="scorecard-head">
          <span className="display">Tap Out</span>
          <span className="label">
            {judges ? 'Décision des juges · 10-9 par round' : 'Aux points'} · après {done} round{done > 1 ? 's' : ''}
          </span>
        </div>
        <div className="scorecard-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col" className="col-rank">
                  #
                </th>
                <th scope="col" className="col-name">
                  Combattant
                </th>
                {Array.from({ length: rounds }, (_, i) => (
                  <th scope="col" key={i} className={i < done ? '' : 'is-future'}>
                    R{i + 1}
                  </th>
                ))}
                <th scope="col" className="col-total">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, row) => (
                <tr
                  key={s.pseudo}
                  className={`${s.rank === 1 ? 'is-leader' : ''} ${s.pseudo === snap.me.pseudo ? 'is-me' : ''}`}
                  style={{ animationDelay: `${120 + row * 70}ms` }}
                >
                  <td className="col-rank display">
                    {s.rank}
                    {standings.length > 1 && <RankMove rank={s.rank} prevRank={s.prevRank} />}
                  </td>
                  <td className="col-name">{s.pseudo}</td>
                  {s.roundScores.map((v, i) => (
                    <td key={i} className={i < done ? (i === done - 1 ? 'is-current' : '') : 'is-future'}>
                      {i >= done ? (
                        '—'
                      ) : judges ? (
                        <>
                          <span className="card-note display">{s.cards[i]}</span>
                          <small className="card-pts">{fmt(v)} pts</small>
                        </>
                      ) : (
                        fmt(v)
                      )}
                    </td>
                  ))}
                  <td className="col-total display">
                    {judges ? (
                      <>
                        {s.cardsTotal}
                        <small className="card-pts">{fmt(s.score)} pts</small>
                      </>
                    ) : (
                      fmt(s.score)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="scorecard-foot">
        <span>
          Prochain round : <strong>Round {done + 1}</strong>
          {nextLevel && ` · ${LEVEL_LABEL[nextLevel]}`}
          {snap.config.format === 'main-event' && done + 1 >= 4 && ' · championship round'}
        </span>
        <div className="next">
          <div className="next-bar" aria-hidden="true">
            <span style={{ animationDuration: `${snap.phaseRemainingMs}ms` }} />
          </div>
          {solo && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => socket.emit('next')}>
              Round {done + 1} <kbd>Entrée</kbd>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
