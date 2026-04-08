import { useState } from 'react';
import { FileText, Gamepad2, Lollipop, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ActionCard, Field, Modal, StatRow } from '../components/ui';
import { createRoom } from '../services/rooms';

const formatPlaytime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
};

function HomePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [roomName, setRoomName] = useState('Salon de X');
  const [privacy, setPrivacy] = useState<'OPEN' | 'PRIVATE'>('PRIVATE');
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);

  const guard = (action: () => void) => {
    if (authLoading) {
      return;
    }
    if (!user) {
      navigate('/auth?mode=login');
      return;
    }
    action();
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      return;
    }
    navigate(`/game/${code}`);
    setShowJoin(false);
    setJoinCode('');
  };

  const handleCreate = async () => {
    if (authLoading) {
      return;
    }
    if (!user) {
      navigate('/auth?mode=login');
      return;
    }
    if (!roomName.trim()) {
      return;
    }

    setCreating(true);
    try {
      const created = await createRoom({
        room_name: roomName.trim(),
        player_uuid: user.uuid,
        pseudo: user.username,
        privacy,
      });
      setShowCreate(false);
      navigate(`/game/${created.room_code}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="layout">
      <section className="column column--sidebar">
        <div className="account-card">
          <div className="account-card__header">
            <p className="account-card__eyebrow">{authLoading ? '\u00A0' : user ? 'Connecté' : 'Espace compte'}</p>
            <h2 className="account-card__title">
              {authLoading ? '\u00A0' : user ? `Bienvenue, ${user.username}` : 'Connexion ou inscription'}
            </h2>
            <p className="account-card__hint">
              {authLoading ? '\u00A0' : user ? user.email : 'Rejoins le lobby pour créer ou rejoindre des parties.'}
            </p>
          </div>

          <div className="account-card__actions">
            {authLoading ? null : user ? (
              <button
                type="button"
                className="account-card__btn account-card__btn--ghost"
                onClick={logout}
                disabled={authLoading}
              >
                Se déconnecter
              </button>
            ) : (
              <>
                <Link to="/auth?mode=login" className="account-card__btn account-card__btn--primary">
                  Se connecter
                </Link>
                <Link to="/auth?mode=register" className="account-card__btn account-card__btn--ghost">
                  S&apos;inscrire
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="stats-card">
          <StatRow label="Niveau" value={user?.level ?? 0} />
          <StatRow label="Temps de jeu" value={user ? formatPlaytime(user.playtime) : '0m'} />
          <StatRow label="Rank" value={user?.rank ?? 'Invité'} />
          <StatRow label="Dernière connexion" value={user?.last_login ? user.last_login.slice(0, 10) : '-'} />
          <div className="stats-card__footer">
            <span className="stat-row__label">Profil</span>
            <span className="stat-row__value">{user ? 'Connecté' : 'Hors ligne'}</span>
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
            onClick={() =>
              guard(() => {
                const currentUser = user;
                if (!currentUser) return;
                setRoomName(`Salon de ${currentUser.username}`);
                setPrivacy('PRIVATE');
                setShowCreate(true);
              })
            }
          />

          <ActionCard title="Stats" tone="slate" icon={Gamepad2} subIcon={<span>🎮</span>} />

          <ActionCard
            title="Rejoindre une partie"
            tone="teal"
            icon={User}
            subIcon={<span>👤</span>}
            onClick={() => setShowJoin(true)}
          />
        </div>
      </section>

      {showCreate ? (
        <Modal title="Créer un salon" onClose={() => setShowCreate(false)}>
          <Field
            label="Nom du salon"
            value={roomName}
            onChange={setRoomName}
            placeholder="Salon de X"
          />
          <div className="field">
            <span className="field__label">Visibilité</span>
            <div className="account-tabs">
              <button
                type="button"
                className={`account-tab ${privacy === 'OPEN' ? 'is-active' : ''}`}
                onClick={() => setPrivacy('OPEN')}
              >
                Publique
              </button>
              <button
                type="button"
                className={`account-tab ${privacy === 'PRIVATE' ? 'is-active' : ''}`}
                onClick={() => setPrivacy('PRIVATE')}
              >
                Privée
              </button>
            </div>
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setShowCreate(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={handleCreate}
              disabled={creating}
            >
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
