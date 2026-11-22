import { useState } from 'react';
import { FORMATS, GAME_LEVELS, type MatchConfig } from '../../shared/protocol';
import { FightPicker, describeFight } from '../components/FightPicker';
import { OctagonBackdrop } from '../components/Octagon';
import { fmt } from '../lib/format';
import { getRecord } from '../lib/records';
import { socket } from '../lib/socket';
import { read, write } from '../lib/storage';

const CONFIG_KEY = 'tapout.lastConfig';

export function lastConfig(): MatchConfig {
  try {
    const c = JSON.parse(read(CONFIG_KEY) ?? 'null');
    if (c && GAME_LEVELS.includes(c.level) && FORMATS.includes(c.format)) return c;
  } catch {
    /* rien */
  }
  return { level: 'mix', format: 'classique' };
}

export function rememberConfig(config: MatchConfig) {
  write(CONFIG_KEY, JSON.stringify(config));
}

interface Props {
  pseudo: string;
  onBack: () => void;
}

/** Choix du niveau et du format, puis lancement du combat solo. */
export function Config({ pseudo, onBack }: Props) {
  const [config, setConfig] = useState<MatchConfig>(lastConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = getRecord(config);

  const start = () => {
    rememberConfig(config);
    setBusy(true);
    setError(null);
    socket.timeout(6000).emit('solo:start', { pseudo, config }, (err, res) => {
      setBusy(false);
      if (err) setError('Le serveur ne répond pas. Réessaie dans un instant.');
      else if (!res.ok) setError(res.error);
    });
  };

  return (
    <main className="config">
      <OctagonBackdrop className="config-backdrop" />

      <header className="config-head">
        <button type="button" className="link-back" onClick={onBack}>
          ← Accueil
        </button>
        <p className="kicker">
          <span className="kicker-bar" />
          Combat solo · {pseudo}
        </p>
        <h1 className="display config-title">Choisis ton combat</h1>
      </header>

      <FightPicker value={config} onChange={setConfig} />

      <footer className="config-foot">
        <div className="config-summary">
          <p className="config-ladder">{describeFight(config)}</p>
          <p className="config-record">
            {record ? (
              <>
                Ton record : <strong>{fmt(record.score)} pts</strong> ({record.correct}/{record.total} bonnes réponses)
              </>
            ) : (
              'Pas encore de record sur ce combat.'
            )}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-primary config-go" onClick={start} disabled={busy}>
          {busy ? 'Entrée dans la cage…' : 'Lancer le combat'}
        </button>
      </footer>
    </main>
  );
}
