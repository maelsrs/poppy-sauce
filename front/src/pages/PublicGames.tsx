import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Field, Modal } from '../components/ui';

type PublicGame = {
  id: string;
  name: string;
  players: string;
  code: string;
  host: string;
  target: number;
  tag?: ReactNode;
};

const publicGames: PublicGame[] = [
  { id: 'a', name: 'Alex', players: '3 / 8', code: 'QWERT', host: 'Alex', target: 100 },
  { id: 'b', name: 'Sam', players: '5 / 8', code: 'NMPOL', host: 'Sam', target: 150 },
  { id: 'c', name: 'Lise', players: '2 / 8', code: 'HJKLR', host: 'Lise', target: 120 },
  { id: 'd', name: 'Rayan', players: '7 / 8', code: 'ZXCVB', host: 'Rayan', target: 200 },
];

function PublicGamesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('Salon de X');

  return (
    <section className="public">
      <header className="public__header">
        <div>
          <p className="public__eyebrow">Lobby</p>
          <h1 className="public__title">Parties publiques</h1>
        </div>
        <button type="button" className="public__create" onClick={() => setShowCreate(true)}>
          Créer un salon
        </button>
      </header>

      <div className="public__grid">
        {publicGames.map((game) => (
          <Link key={game.id} to={`/game/${game.code}`} className="game-card" aria-label={`Rejoindre ${game.name}`}>
            <header className="game-card__top">
              <h2 className="game-card__title">Salon: {game.name}</h2>
              <span className="game-card__players">{game.players} joueurs</span>
            </header>
            <div className="game-card__code">CODE · {game.code}</div>
            <div className="game-card__meta">
              <span className="game-card__host">Hôte : {game.host}</span>
              <span className="game-card__target">🎯 {game.target}</span>
            </div>
          </Link>
        ))}
      </div>

      {showCreate ? (
        <Modal title="Créer un salon" onClose={() => setShowCreate(false)}>
          <Field label="Nom du salon" value={roomName} onChange={setRoomName} placeholder="Salon de X" />
          <div className="modal__actions">
            <button type="button" className="account-card__btn account-card__btn--ghost" onClick={() => setShowCreate(false)}>
              Annuler
            </button>
            <button type="button" className="account-card__btn account-card__btn--primary" onClick={() => setShowCreate(false)}>
              Créer
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

export default PublicGamesPage;
