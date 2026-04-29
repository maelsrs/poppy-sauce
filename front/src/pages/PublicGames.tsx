import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Field, Modal } from "../components/ui";
import {
  createRoom,
  fetchPublicRooms,
  type PublicRoom,
} from "../services/rooms";

function PublicGamesPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("Salon de X");
  const [privacy, setPrivacy] = useState<"OPEN" | "PRIVATE">("OPEN");
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user) {
      setRoomName(`Salon de ${user.username}`);
    } else {
      setRoomName("Salon de X");
    }
  }, [user]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data = await fetchPublicRooms();
        if (mounted) {
          setRooms(data);
          setError(null);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement des rooms.";
        if (mounted) {
          setError(message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
    const interval = window.setInterval(load, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleCreate = async () => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }
    if (!roomName.trim()) return;

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
    <section className="public">
      <header className="public__header">
        <div>
          <p className="public__eyebrow">Lobby</p>
          <h1 className="public__title">Parties publiques</h1>
        </div>
        <button
          type="button"
          className="public__create"
          onClick={() => setShowCreate(true)}
        >
          Créer un salon
        </button>
      </header>

      <div className="public__grid">
        {loading ? <div className="not-found">Chargement…</div> : null}
        {!loading && error ? <div className="not-found">{error}</div> : null}
        {!loading && !error && rooms.length === 0 ? (
          <div className="not-found">Aucune room publique.</div>
        ) : null}

        {rooms.map((room) => {
          return (
            <Link
              key={room.room_uuid}
              to={`/game/${room.room_code}`}
              className="game-card"
              aria-label={`Rejoindre ${room.room_name}`}
            >
              <header className="game-card__top">
                <h2 className="game-card__title">Salon: {room.room_name}</h2>
                <span className="game-card__players">
                  {room.players_connected} / {room.players_total} joueurs
                </span>
              </header>
              <div className="game-card__code">CODE · {room.room_code}</div>
              <div className="game-card__meta">
                <span className="game-card__host">
                  Hôte : {room.host ?? "-"}
                </span>
                <span className="game-card__target">
                  🎯 {room.score_objective}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

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
                className={`account-tab ${privacy === "OPEN" ? "is-active" : ""}`}
                onClick={() => setPrivacy("OPEN")}
              >
                Publique
              </button>
              <button
                type="button"
                className={`account-tab ${privacy === "PRIVATE" ? "is-active" : ""}`}
                onClick={() => setPrivacy("PRIVATE")}
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
    </section>
  );
}

export default PublicGamesPage;
