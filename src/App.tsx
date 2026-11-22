import { useEffect, useRef, useState } from 'react';
import { ROOM_CODE_LENGTH, type MatchSnapshot, type RoomSnapshot } from '../shared/protocol';
import { socket } from './lib/socket';
import { Home } from './screens/Home';
import { Config } from './screens/Config';
import { Join } from './screens/Join';
import { WaitingRoom } from './screens/WaitingRoom';
import { Game } from './screens/Game';

export interface Received {
  snap: MatchSnapshot;
  /** Moment de réception (performance.now), pour caler les chronos. */
  at: number;
}

type Lobby = { screen: 'home' } | { screen: 'config'; pseudo: string } | { screen: 'join'; code: string };

/** Code d'un lien d'invitation : /salon/ABC234 */
function codeFromUrl(): string | null {
  const m = window.location.pathname.match(new RegExp(`^/salon/([A-Za-z0-9]{${ROOM_CODE_LENGTH}})/?$`));
  return m ? m[1].toUpperCase() : null;
}

function setUrl(path: string) {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

export function App() {
  const [received, setReceived] = useState<Received | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [lobby, setLobby] = useState<Lobby>(() => {
    const code = codeFromUrl();
    return code ? { screen: 'join', code } : { screen: 'home' };
  });
  const [online, setOnline] = useState(true);
  const inRoom = useRef(false);

  useEffect(() => {
    const onState = (snap: MatchSnapshot) => setReceived({ snap, at: performance.now() });
    const onLeft = () => setReceived(null);
    const onRoom = (r: RoomSnapshot | null) => {
      setRoom(r);
      if (r) {
        inRoom.current = true;
        setUrl(`/salon/${r.code}`);
        if (r.phase === 'lobby') setReceived(null); // retour en salle d'attente
      } else if (inRoom.current) {
        // On vient de quitter (ou de perdre) le salon : retour à l'accueil.
        inRoom.current = false;
        setReceived((prev) => (prev?.snap.kind === 'salon' ? null : prev));
        setUrl('/');
        setLobby({ screen: 'home' });
      }
    };
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    socket.on('state', onState);
    socket.on('left', onLeft);
    socket.on('room', onRoom);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('state', onState);
      socket.off('left', onLeft);
      socket.off('room', onRoom);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Chaque nouvel écran repart du haut (la révélation reste sur l'écran Question).
  const screenKey = received
    ? `${received.snap.matchId}-${received.snap.phase === 'reveal' ? 'question' : received.snap.phase}`
    : room
      ? `room-${room.phase}`
      : lobby.screen;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screenKey]);

  const leave = () => {
    if (room) socket.emit('room:leave');
    else socket.emit('leave');
    inRoom.current = false;
    setReceived(null);
    setRoom(null);
    setUrl('/');
    setLobby({ screen: 'home' });
  };

  let screen;
  if (received && (received.snap.kind === 'solo' || room)) screen = <Game received={received} room={room} onLeave={leave} />;
  else if (room) screen = <WaitingRoom room={room} onLeave={leave} />;
  else if (lobby.screen === 'config')
    screen = <Config pseudo={lobby.pseudo} onBack={() => setLobby({ screen: 'home' })} />;
  else if (lobby.screen === 'join')
    screen = (
      <Join
        initialCode={lobby.code}
        onBack={() => {
          setUrl('/');
          setLobby({ screen: 'home' });
        }}
      />
    );
  else
    screen = (
      <Home onSolo={(pseudo) => setLobby({ screen: 'config', pseudo })} onJoin={() => setLobby({ screen: 'join', code: '' })} />
    );

  return (
    <>
      {screen}
      {!online && (
        <div className="offline" role="status">
          Connexion perdue · on se reconnecte…
        </div>
      )}
    </>
  );
}
