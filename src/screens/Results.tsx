import { useState } from 'react';
import {
  FORMAT_INFO,
  GAME_LEVEL_LABEL,
  SCORING_INFO,
  type MatchSnapshot,
  type RoomSnapshot,
  type Standing,
} from '../../shared/protocol';
import { OctagonBackdrop } from '../components/Octagon';
import { RankMove } from '../components/RankMove';
import { fmt, secs } from '../lib/format';
import { settleRecord, type PersonalRecord, type RecordOutcome } from '../lib/records';
import { socket } from '../lib/socket';

/** Une colonne du « Tale of the Tape ». */
interface Corner {
  title: string;
  name: string;
  score: number;
  correct: number;
  total: number;
  fastestMs: number | null;
  avgMs: number;
  roundScores: number[];
  /** Notes des juges par round (salons en décision des juges). */
  cards?: number[];
}

const fromStanding = (s: Standing, title: string, total: number): Corner => ({
  title,
  name: s.pseudo,
  score: s.score,
  correct: s.correct,
  total,
  fastestMs: s.fastestMs,
  avgMs: s.avgMs,
  roundScores: s.roundScores,
  cards: s.cards,
});

const fromRecord = (r: PersonalRecord, name: string): Corner => ({
  title: 'Ton record',
  name,
  score: r.score,
  correct: r.correct,
  total: r.total,
  fastestMs: r.fastestMs,
  avgMs: r.avgMs,
  roundScores: r.roundScores,
});

interface Props {
  snap: MatchSnapshot;
  room: RoomSnapshot | null;
  onLeave: () => void;
}

export function Results({ snap, room, onLeave }: Props) {
  const standings = snap.standings ?? [];
  const solo = snap.kind === 'solo';
  const judges = !solo && snap.config.scoring === 'juges';
  const winner = standings[0];
  const me = standings.find((s) => s.pseudo === snap.me.pseudo) ?? winner;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Solo : comparaison au record personnel, réglée une seule fois par partie.
  const [outcome] = useState<RecordOutcome | null>(() =>
    solo && me
      ? settleRecord(snap.matchId, snap.config, {
          score: me.score,
          correct: me.correct,
          total: snap.totalQuestions,
          fastestMs: me.fastestMs,
          avgMs: me.avgMs,
          roundScores: me.roundScores,
          date: new Date().toISOString(),
        })
      : null,
  );

  const rematch = () => {
    setBusy(true);
    setError(null);
    const done = (err: Error | null, res?: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (err) setError('Le serveur ne répond pas. Réessaie dans un instant.');
      else if (res && !res.ok) setError(res.error ?? null);
    };
    if (solo) socket.timeout(6000).emit('solo:start', { pseudo: snap.me.pseudo, config: snap.config }, done);
    else socket.timeout(6000).emit('room:rematch', done);
  };

  if (!winner || !me) return null;

  let line: string;
  let beltLabel: string;
  if (solo) {
    if (outcome?.isNew) {
      line = outcome.previous ? 'And new…' : 'Premier record…';
      beltLabel = 'Nouveau record personnel';
    } else {
      line = 'Pas de nouveau record';
      beltLabel = outcome?.previous ? `Record à battre : ${fmt(outcome.previous.score)} pts` : 'Score final';
    }
  } else {
    line = snap.wireToWire ? 'And still…' : 'And new…';
    beltLabel = judges
      ? `Décision des juges${standings[1] && standings[1].cardsTotal === winner.cardsTotal ? ' · départagé aux points' : ''} · ${fmt(winner.score)} pts`
      : 'Champion du salon';
  }
  // Aux juges, la ceinture affiche les cartes comme une annonce officielle : « 30-28 ».
  const beltScore = solo
    ? `${fmt(me.score)} pts`
    : judges
      ? `${winner.cardsTotal}-${standings[1]?.cardsTotal ?? winner.cardsTotal}`
      : `${fmt(winner.score)} pts`;

  const left = fromStanding(solo ? me : winner, solo ? 'Cette partie' : '1re place', snap.totalQuestions);
  const right: Corner | null = solo
    ? outcome?.previous
      ? fromRecord(outcome.previous, me.pseudo)
      : null
    : standings[1]
      ? fromStanding(standings[1], '2e place', snap.totalQuestions)
      : null;

  return (
    <main className="results">
      <OctagonBackdrop className="results-backdrop" />

      <p className="kicker">
        <span className="kicker-bar" />
        Résultat officiel · {FORMAT_INFO[snap.config.format].label} · {GAME_LEVEL_LABEL[snap.config.level]}
        {!solo && ` · ${SCORING_INFO[snap.config.scoring ?? 'points'].label}`}
      </p>

      <section className="announce" aria-live="polite">
        <p className="announce-line">{line}</p>
        <h1 className="display announce-name">{solo ? me.pseudo : winner.pseudo}</h1>
        <div className={`belt ${solo && !outcome?.isNew ? 'belt-plain' : ''}`}>
          <span className="display belt-score">{beltScore}</span>
          <span className="label belt-label">{beltLabel}</span>
        </div>
      </section>

      {!solo && <Podium standings={standings} judges={judges} />}

      <TaleOfTheTape left={left} right={right} judges={judges} />

      {!solo && standings.length > 3 && (
        <ol className="results-rest">
          {standings.slice(3).map((s) => (
            <li key={s.pseudo}>
              <span className="display">{s.rank}</span>
              <span>{s.pseudo}</span>
              <RankMove rank={s.rank} prevRank={s.prevRank} />
              <span className="display">{judges ? `${s.cardsTotal} · ${fmt(s.score)} pts` : fmt(s.score)}</span>
            </li>
          ))}
        </ol>
      )}

      {solo ? (
        <div className="results-actions">
          <button type="button" className="btn btn-primary" onClick={rematch} disabled={busy}>
            Revanche
          </button>
          <button type="button" className="btn btn-secondary" onClick={onLeave}>
            Retour à l'accueil
          </button>
        </div>
      ) : room?.isHost ? (
        <div className="results-actions">
          <button type="button" className="btn btn-primary" onClick={rematch} disabled={busy}>
            Revanche
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => socket.emit('room:lobby')}>
            Salle d'attente
          </button>
          <button type="button" className="btn btn-secondary" onClick={onLeave}>
            Quitter le salon
          </button>
        </div>
      ) : (
        <div className="results-actions">
          <p className="results-wait">En attente de l'hôte pour la revanche…</p>
          <button type="button" className="btn btn-secondary" onClick={onLeave}>
            Quitter le salon
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function Podium({ standings, judges }: { standings: Standing[]; judges: boolean }) {
  const order = [standings[1], standings[0], standings[2]].filter(Boolean);
  return (
    <ol className="podium" aria-label="Podium">
      {order.map((s) => (
        <li key={s.pseudo} className={`podium-step podium-${s.rank}`}>
          <span className="podium-name">{s.pseudo}</span>
          <span className="display podium-score">{judges ? `${s.cardsTotal} pts juges` : fmt(s.score)}</span>
          <span className="display podium-rank">{s.rank}</span>
        </li>
      ))}
    </ol>
  );
}

/** Face à face façon pesée : les stats de deux coins, la meilleure valeur en or. */
function TaleOfTheTape({ left, right, judges = false }: { left: Corner; right: Corner | null; judges?: boolean }) {
  type Row = { label: string; l: string; r: string; better: 'l' | 'r' | null };
  const cmp = (a: number | null, b: number | null, higherIsBetter: boolean): 'l' | 'r' | null => {
    if (a === null || b === null || a === b) return null;
    return (a > b) === higherIsBetter ? 'l' : 'r';
  };
  const total = (c: Corner | null) => (c?.cards ?? []).reduce((a, b) => a + b, 0);

  const rows: Row[] = [
    ...(judges && right
      ? [
          {
            label: 'Cartes des juges',
            l: (left.cards ?? []).join('-') + ` = ${total(left)}`,
            r: (right.cards ?? []).join('-') + ` = ${total(right)}`,
            better: cmp(total(left), total(right), true),
          },
        ]
      : []),
    { label: 'Total', l: `${fmt(left.score)}`, r: right ? fmt(right.score) : '—', better: right ? cmp(left.score, right.score, true) : null },
    {
      label: 'Bonnes réponses',
      l: `${left.correct}/${left.total}`,
      r: right ? `${right.correct}/${right.total}` : '—',
      better: right ? cmp(left.correct, right.correct, true) : null,
    },
    {
      label: 'Réponse la plus rapide',
      l: secs(left.fastestMs),
      r: right ? secs(right.fastestMs) : '—',
      better: right ? cmp(left.fastestMs, right.fastestMs, false) : null,
    },
    {
      label: 'Temps moyen',
      l: secs(left.avgMs),
      r: right ? secs(right.avgMs) : '—',
      better: right ? cmp(left.avgMs, right.avgMs, false) : null,
    },
    ...left.roundScores.map((v, i) => ({
      label: `Round ${i + 1}`,
      l: fmt(v),
      r: right && right.roundScores[i] !== undefined ? fmt(right.roundScores[i]) : '—',
      better: right && right.roundScores[i] !== undefined ? cmp(v, right.roundScores[i], true) : null,
    })),
  ];

  return (
    <section className="tape" aria-label="Tale of the Tape">
      <h2 className="display tape-title">Tale of the Tape</h2>
      <div className="tape-corners">
        <div className="tape-corner tape-red">
          <span className="label">{left.title}</span>
          <span className="display tape-name">{left.name}</span>
        </div>
        <div className="tape-vs display">VS</div>
        <div className="tape-corner tape-blue">
          <span className="label">{right ? right.title : 'Ton record'}</span>
          <span className="display tape-name">{right ? right.name : 'Aucun'}</span>
        </div>
      </div>
      <dl className="tape-rows">
        {rows.map((row) => (
          <div key={row.label} className="tape-row">
            <dd className={`tape-l ${row.better === 'l' ? 'is-better' : ''}`}>{row.l}</dd>
            <dt className="label">{row.label}</dt>
            <dd className={`tape-r ${row.better === 'r' ? 'is-better' : ''}`}>{row.r}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
