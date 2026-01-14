import { useState } from 'react';
import { FileText, Gamepad2, Lollipop, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionCard, Field, Modal, StatRow } from '../components/ui';

function HomePage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [roomName, setRoomName] = useState('Salon de X');
  const [joinCode, setJoinCode] = useState('');

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      return;
    }
    navigate(`/game/${code}`);
    setShowJoin(false);
    setJoinCode('');
  };

  return (
    <div className="layout">
      <section className="column column--sidebar">
        <div className="account-card">
          <div className="account-card__header">
            <p className="account-card__eyebrow">Espace compte</p>
            <h2 className="account-card__title">Connexion ou inscription</h2>
            <p className="account-card__hint">Rejoins le lobby pour créer ou rejoindre des parties.</p>
          </div>

          <div className="account-card__actions">
            <Link to="/auth?mode=login" className="account-card__btn account-card__btn--primary">
              Se connecter
            </Link>
            <Link to="/auth?mode=register" className="account-card__btn account-card__btn--ghost">
              S&apos;inscrire
            </Link>
          </div>
        </div>

        <div className="stats-card">
          <StatRow label="Âge du compte" value="0" unit="j" />
          <StatRow label="Parties jouées" value="0" />
          <StatRow label="Temps de jeu" value="0mn 0s" />
          <StatRow label="Succès" value="A venir" />
          <div className="stats-card__footer">
            <span className="stat-row__label">Titre</span>
            <span className="stat-row__value">Membre</span>
          </div>
        </div>
      </section>

      <section className="column column--actions">
        <div className="actions-grid">
          <ActionCard
            title="Parties publiques"
            tone="blue"
            icon={FileText}
            subIcon={<span>📝</span>}
            onClick={() => navigate('/public-games')}
          />

          <ActionCard
            title="Créer une partie"
            tone="purple"
            icon={Lollipop}
            subIcon={<span>🍭</span>}
            onClick={() => setShowCreate(true)}
          />

          <ActionCard title="Stats" tone="slate" icon={Gamepad2} subIcon={<span>🎮</span>} />

          <ActionCard title="Rejoindre une partie" tone="teal" icon={User} subIcon={<span>👤</span>} onClick={() => setShowJoin(true)} />
        </div>
      </section>

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

      {showJoin ? (
        <Modal title="Rejoindre une partie" onClose={() => setShowJoin(false)}>
          <Field label="Code de la partie" value={joinCode} onChange={setJoinCode} placeholder="ABCDE" />
          <div className="modal__actions">
            <button type="button" className="account-card__btn account-card__btn--ghost" onClick={() => setShowJoin(false)}>
              Annuler
            </button>
            <button type="button" className="account-card__btn account-card__btn--primary" onClick={handleJoin}>
              Rejoindre
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default HomePage;
