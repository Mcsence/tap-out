import { useState } from 'react';
import {
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  SCORING_INFO,
  type MatchConfig,
  type RoomSnapshot,
} from '../../shared/protocol';
import { FightPicker, describeFight } from '../components/FightPicker';
import { OctagonBackdrop } from '../components/Octagon';
import { socket } from '../lib/socket';
import { rememberConfig } from './Config';

export const roomLink = (code: string) => `${window.location.origin}/salon/${code}`;

/** Salle d'attente du salon : code à partager, joueurs connectés, choix du combat (hôte) et lancement. */
export function WaitingRoom({ room, onLeave }: { room: RoomSnapshot; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = room.players.filter((p) => p.connected).length;
  const canStart = connected >= ROOM_MIN_PLAYERS;
  const playing = room.phase === 'playing';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(room.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie impossible : sélectionne le lien à la main.');
    }
  };

  const setConfig = (config: MatchConfig) => {
    rememberConfig(config);
    socket.emit('room:config', { config });
  };

  const start = () => {
    setBusy(true);
    setError(null);
    socket.timeout(6000).emit('room:start', (err, res) => {
      setBusy(false);
      if (err) setError('Le serveur ne répond pas. Réessaie dans un instant.');
      else if (!res.ok) setError(res.error);
    });
  };

  return (
    <main className="lobby">
      <OctagonBackdrop className="lobby-backdrop" />

      <header className="lobby-head">
        <button type="button" className="link-back" onClick={onLeave}>
          ← Quitter le salon
        </button>
        <p className="kicker">
          <span className="kicker-bar" />
          Salon privé · {room.isHost ? 'tu es l’hôte' : 'en attente de l’hôte'}
        </p>
        <h1 className="display lobby-title">Salle d'attente</h1>
      </header>

      <section className="lobby-code" aria-label="Code du salon">
        <div>
          <span className="label">Code du salon</span>
          <span className="display lobby-code-value">{room.code}</span>
        </div>
        <div className="lobby-share">
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? 'Lien copié !' : 'Copier le lien'}
          </button>
          <span className="lobby-link">{roomLink(room.code)}</span>
        </div>
      </section>

      {playing && (
        <p className="lobby-banner" role="status">
          Un combat est en cours dans ce salon. Tu joueras le prochain : l'hôte lancera la revanche à la fin.
        </p>
      )}

      <section className="lobby-players" aria-labelledby="players-title">
        <h2 id="players-title" className="label">
          Combattants · {room.players.length}/{ROOM_MAX_PLAYERS}
        </h2>
        <ul>
          {room.players.map((p) => (
            <li key={p.pseudo} className={`lobby-player ${p.connected ? '' : 'is-off'} ${p.isMe ? 'is-me' : ''}`}>
              <span className="lobby-avatar display" aria-hidden="true">
                {p.pseudo.slice(0, 2).toUpperCase()}
              </span>
              <span className="lobby-name">
                {p.pseudo}
                {p.isMe && <span className="lobby-me"> (toi)</span>}
              </span>
              <span className="lobby-tags">
                {p.isHost && <span className="tag tag-gold">Hôte</span>}
                {!p.connected && <span className="tag">Déconnecté</span>}
                {p.waiting && p.connected && <span className="tag">Prochain combat</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {room.isHost && !playing ? (
        <FightPicker value={room.config} onChange={setConfig} withScoring />
      ) : (
        <p className="lobby-fight">
          <span className="label">Combat choisi par l'hôte</span>
          <strong>{describeFight(room.config, true)}</strong>
          <span className="choice-text">{SCORING_INFO[room.config.scoring ?? 'points'].text}</span>
        </p>
      )}

      <footer className="config-foot">
        <div className="config-summary">
          {room.isHost && !playing && <p className="config-ladder">{describeFight(room.config, true)}</p>}
          <p className="config-record">
            {playing
              ? 'Combat en cours…'
              : !canStart
                ? `Il faut au moins ${ROOM_MIN_PLAYERS} combattants connectés : partage le code ou le lien.`
                : room.isHost
                  ? `${connected} combattants prêts.`
                  : "L'hôte va lancer le combat."}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        {room.isHost && !playing && (
          <button type="button" className="btn btn-primary config-go" onClick={start} disabled={busy || !canStart}>
            {busy ? 'Préparation…' : 'Lancer le combat'}
          </button>
        )}
      </footer>
    </main>
  );
}
