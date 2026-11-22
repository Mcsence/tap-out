import type { RoomSnapshot } from '../../shared/protocol';
import type { Received } from '../App';
import { RoundIntro } from './RoundIntro';
import { QuestionScreen } from './QuestionScreen';
import { Scorecard } from './Scorecard';
import { Results } from './Results';

interface Props {
  received: Received;
  room: RoomSnapshot | null;
  onLeave: () => void;
}

/** Aiguille vers le bon écran selon la phase envoyée par le serveur. */
export function Game({ received, room, onLeave }: Props) {
  const { snap, at } = received;
  switch (snap.phase) {
    case 'round-intro':
      return <RoundIntro key={`${snap.matchId}-${snap.round.number}`} snap={snap} />;
    case 'question':
    case 'reveal':
      return (
        <QuestionScreen
          key={`${snap.matchId}-${snap.question?.seq}`}
          snap={snap}
          at={at}
          onLeave={onLeave}
        />
      );
    case 'scorecard':
      return <Scorecard key={`${snap.matchId}-sc-${snap.round.number}`} snap={snap} />;
    case 'end':
      return <Results key={snap.matchId} snap={snap} room={room} onLeave={onLeave} />;
  }
}
