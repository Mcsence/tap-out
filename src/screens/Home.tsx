import { useRef, useState, type FormEvent } from 'react';
import { PSEUDO_MAX, PSEUDO_MIN, cleanPseudo } from '../../shared/protocol';
import { OctagonBackdrop } from '../components/Octagon';
import { socket } from '../lib/socket';
import { read, write } from '../lib/storage';

const PSEUDO_KEY = 'tapout.pseudo';

interface Props {
  onSolo: (pseudo: string) => void;
  onJoin: () => void;
}

export function Home({ onSolo, onJoin }: Props) {
  const [pseudo, setPseudo] = useState(() => read(PSEUDO_KEY) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  /** Pseudo valide et mémorisé, ou null (avec un message). */
  const checkedPseudo = (): string | null => {
    const name = cleanPseudo(pseudo);
    if (name.length < PSEUDO_MIN) {
      setError("Choisis ton nom de combattant avant d'entrer dans l'Octogone.");
      input.current?.focus();
      return null;
    }
    write(PSEUDO_KEY, name);
    return name;
  };

  const playSolo = (e: FormEvent) => {
    e.preventDefault();
    const name = checkedPseudo();
    if (name) onSolo(name);
  };

  const createRoom = () => {
    const name = checkedPseudo();
    if (!name) return;
    setBusy(true);
    socket.timeout(6000).emit('room:create', { pseudo: name }, (err, res) => {
      setBusy(false);
      if (err) setError('Le serveur ne répond pas. Réessaie dans un instant.');
      else if (!res.ok) setError(res.error);
    });
  };

  const joinRoom = () => {
    write(PSEUDO_KEY, cleanPseudo(pseudo));
    onJoin();
  };

  return (
    <main className="home">
      <OctagonBackdrop className="home-backdrop" />

      <section className="home-main">
        <p className="kicker">
          <span className="kicker-bar" />
          Le quiz MMA entre potes
        </p>
        <h1 className="home-title display">
          Tap <span>Out</span>
        </h1>
        <p className="home-pitch">
          Histoire, champions, records, règles : prouve que tu connais l'UFC mieux que tes potes. Une question,
          4 réponses, 20 secondes. Le plus rapide marque le plus.
        </p>

        <form className="home-form" onSubmit={playSolo} noValidate>
          <label className="label" htmlFor="pseudo">
            Ton nom de combattant
          </label>
          <input
            ref={input}
            id="pseudo"
            className={`field ${error ? 'field-error' : ''}`}
            value={pseudo}
            maxLength={PSEUDO_MAX}
            placeholder="Ex. : Le Boucher de Brest"
            autoComplete="nickname"
            spellCheck={false}
            onChange={(e) => {
              setPseudo(e.target.value);
              if (error) setError(null);
            }}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="home-actions">
            <button type="submit" className="btn btn-primary btn-xl">
              Jouer en solo
            </button>
            <div className="home-actions-row">
              <button type="button" className="btn btn-secondary" onClick={createRoom} disabled={busy}>
                {busy ? 'Création…' : 'Créer un salon'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={joinRoom}>
                Rejoindre un salon
              </button>
            </div>
          </div>
        </form>
      </section>

      <aside className="fight-card" aria-label="Au programme">
        <p className="fight-card-head label">Au programme</p>
        <div className="fight-card-row">
          <span className="display fight-card-big">3×5</span>
          <span>
            <strong>Combat classique</strong>
            <br />3 rounds de 5 questions
          </span>
        </div>
        <div className="fight-card-row fight-card-main">
          <span className="display fight-card-big">5×5</span>
          <span>
            <strong>Main Event</strong>
            <br />5 rounds de 5 questions
          </span>
        </div>
        <div className="fight-card-levels">
          {['Facile', 'Moyen', 'Difficile', 'Expert', 'Mix'].map((l) => (
            <span key={l} className={`tag ${l === 'Mix' ? 'tag-red' : ''}`}>
              {l}
            </span>
          ))}
        </div>
        <p className="fight-card-foot">Jusqu'à 1000 points par bonne réponse, selon ta vitesse.</p>
      </aside>

      <footer className="home-foot">Jeu de fans non officiel, sans lien avec l'UFC.</footer>
    </main>
  );
}
