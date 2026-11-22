import { useRef, useState, type FormEvent } from 'react';
import { PSEUDO_MAX, PSEUDO_MIN, ROOM_CODE_LENGTH, cleanCode, cleanPseudo } from '../../shared/protocol';
import { OctagonBackdrop } from '../components/Octagon';
import { socket } from '../lib/socket';
import { read, write } from '../lib/storage';

interface Props {
  initialCode: string;
  onBack: () => void;
}

/** Rejoindre un salon : code (prérempli si on arrive par un lien) et pseudo. */
export function Join({ initialCode, onBack }: Props) {
  const [code, setCode] = useState(cleanCode(initialCode));
  const [pseudo, setPseudo] = useState(() => read('tapout.pseudo') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const pseudoInput = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = cleanPseudo(pseudo);
    if (code.length !== ROOM_CODE_LENGTH) {
      setError(`Le code du salon fait ${ROOM_CODE_LENGTH} caractères.`);
      codeInput.current?.focus();
      return;
    }
    if (name.length < PSEUDO_MIN) {
      setError('Choisis ton nom de combattant.');
      pseudoInput.current?.focus();
      return;
    }
    write('tapout.pseudo', name);
    setBusy(true);
    setError(null);
    socket.timeout(6000).emit('room:join', { code, pseudo: name }, (err, res) => {
      setBusy(false);
      if (err) setError('Le serveur ne répond pas. Réessaie dans un instant.');
      else if (!res.ok) setError(res.error);
    });
  };

  return (
    <main className="join">
      <OctagonBackdrop className="join-backdrop" />
      <form className="join-card" onSubmit={submit} noValidate>
        <button type="button" className="link-back" onClick={onBack}>
          ← Accueil
        </button>
        <p className="kicker">
          <span className="kicker-bar" />
          {initialCode ? 'Tu es invité dans un salon' : 'Salon privé'}
        </p>
        <h1 className="display join-title">Rejoindre un salon</h1>

        <label className="label" htmlFor="code">
          Code du salon
        </label>
        <input
          ref={codeInput}
          id="code"
          className="field field-code display"
          value={code}
          onChange={(e) => {
            setCode(cleanCode(e.target.value));
            if (error) setError(null);
          }}
          placeholder="ABC234"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          autoFocus={!initialCode}
        />

        <label className="label" htmlFor="join-pseudo">
          Ton nom de combattant
        </label>
        <input
          ref={pseudoInput}
          id="join-pseudo"
          className="field"
          value={pseudo}
          maxLength={PSEUDO_MAX}
          onChange={(e) => {
            setPseudo(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Ex. : Le Boucher de Brest"
          autoComplete="nickname"
          spellCheck={false}
          autoFocus={!!initialCode}
        />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-xl" disabled={busy}>
          {busy ? 'Entrée dans le salon…' : 'Entrer dans le salon'}
        </button>
        <p className="join-hint">Déjà venu avec ce pseudo pendant le combat ? Tu retrouves ta place et tes points.</p>
      </form>
    </main>
  );
}
