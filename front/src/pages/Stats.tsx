import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  fetchLeaderboard,
  fetchStats,
  type LeaderboardResponse,
  type PersonalStats,
} from "../services/stats";

type Tab = "personal" | "leaderboard";

const formatPlaytime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
};

const formatResponseTime = (ms: number | null) => {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

function StatsPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("personal");
  const [personal, setPersonal] = useState<PersonalStats | null>(null);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      fetchStats()
        .then(setPersonal)
        .catch(() => {});
    }
    fetchLeaderboard()
      .then(setBoard)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  return (
    <div className="layout">
      <section className="column column--sidebar">
        <div className="admin-nav">
          <p className="admin-nav__eyebrow">Statistiques</p>
          <h2 className="admin-nav__title">
            {user ? user.username : "Classement"}
          </h2>

          <div className="admin-tabs">
            {user && (
              <button
                type="button"
                className={`admin-tab ${tab === "personal" ? "is-active" : ""}`}
                onClick={() => setTab("personal")}
              >
                Mes stats
              </button>
            )}
            <button
              type="button"
              className={`admin-tab ${tab === "leaderboard" ? "is-active" : ""}`}
              onClick={() => setTab("leaderboard")}
            >
              Classement
            </button>
          </div>
        </div>

        {tab === "personal" && personal && (
          <div className="admin-stats-card">
            <div className="stat-row">
              <span className="stat-row__label">Parties jouées</span>
              <span className="stat-row__value">{personal.games_played}</span>
            </div>
            <div className="stat-row">
              <span className="stat-row__label">Victoires</span>
              <span className="stat-row__value">{personal.wins}</span>
            </div>
            <div className="stat-row">
              <span className="stat-row__label">Taux de victoire</span>
              <span className="stat-row__value">{personal.win_rate}%</span>
            </div>
          </div>
        )}
      </section>

      <section className="column column--actions">
        {loading ? (
          <div className="admin-loading">Chargement...</div>
        ) : tab === "personal" && personal ? (
          <div className="admin-list-card">
            <div className="admin-list-header">
              <h3 className="admin-list-header__title">Mes statistiques</h3>
            </div>
            <div className="admin-table">
              <div className="admin-table__head">
                <span className="admin-col admin-col--name">Statistique</span>
                <span className="admin-col admin-col--rank">Valeur</span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">
                  Parties jouées
                </span>
                <span className="admin-col admin-col--rank">
                  {personal.games_played}
                </span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">Victoires</span>
                <span className="admin-col admin-col--rank">
                  {personal.wins} ({personal.win_rate}%)
                </span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">
                  Bonnes réponses
                </span>
                <span className="admin-col admin-col--rank">
                  {personal.correct_answers} / {personal.total_answers} (
                  {personal.accuracy}%)
                </span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">
                  Meilleur score
                </span>
                <span className="admin-col admin-col--rank">
                  {personal.best_score}
                </span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">
                  Temps de réponse moyen
                </span>
                <span className="admin-col admin-col--rank">
                  {formatResponseTime(personal.avg_response_time_ms)}
                </span>
              </div>
              <div className="admin-table__row">
                <span className="admin-col admin-col--name">
                  Temps de jeu total
                </span>
                <span className="admin-col admin-col--rank">
                  {formatPlaytime(personal.playtime)}
                </span>
              </div>
            </div>
          </div>
        ) : tab === "personal" && !user ? (
          <div className="not-found">
            Connecte-toi pour voir tes statistiques.
          </div>
        ) : tab === "leaderboard" && board ? (
          <div className="admin-list-card">
            <div className="admin-list-header">
              <h3 className="admin-list-header__title">Classement</h3>
            </div>

            <h4
              className="admin-list-header__title"
              style={{
                padding: "0.75rem 1rem 0.25rem",
                fontSize: "0.85rem",
                opacity: 0.7,
              }}
            >
              Top victoires
            </h4>
            <div className="admin-table">
              <div className="admin-table__head">
                <span className="admin-col admin-col--id">#</span>
                <span className="admin-col admin-col--name">Joueur</span>
                <span className="admin-col admin-col--rank">Victoires</span>
              </div>
              {board.top_wins.length === 0 && (
                <div className="admin-empty">Aucune donnée.</div>
              )}
              {board.top_wins.map((e, i) => (
                <div key={e.username} className="admin-table__row">
                  <span className="admin-col admin-col--id">{i + 1}</span>
                  <span className="admin-col admin-col--name">
                    {e.username}
                  </span>
                  <span className="admin-col admin-col--rank">{e.value}</span>
                </div>
              ))}
            </div>

            <h4
              className="admin-list-header__title"
              style={{
                padding: "0.75rem 1rem 0.25rem",
                fontSize: "0.85rem",
                opacity: 0.7,
              }}
            >
              Top temps de jeu
            </h4>
            <div className="admin-table">
              <div className="admin-table__head">
                <span className="admin-col admin-col--id">#</span>
                <span className="admin-col admin-col--name">Joueur</span>
                <span className="admin-col admin-col--rank">Temps</span>
              </div>
              {board.top_playtime.length === 0 && (
                <div className="admin-empty">Aucune donnée.</div>
              )}
              {board.top_playtime.map((e, i) => (
                <div key={e.username} className="admin-table__row">
                  <span className="admin-col admin-col--id">{i + 1}</span>
                  <span className="admin-col admin-col--name">
                    {e.username}
                  </span>
                  <span className="admin-col admin-col--rank">
                    {formatPlaytime(e.value)}
                  </span>
                </div>
              ))}
            </div>

            <h4
              className="admin-list-header__title"
              style={{
                padding: "0.75rem 1rem 0.25rem",
                fontSize: "0.85rem",
                opacity: 0.7,
              }}
            >
              Joueurs les plus rapides
            </h4>
            <div className="admin-table">
              <div className="admin-table__head">
                <span className="admin-col admin-col--id">#</span>
                <span className="admin-col admin-col--name">Joueur</span>
                <span className="admin-col admin-col--rank">Temps moyen</span>
              </div>
              {board.fastest_players.length === 0 && (
                <div className="admin-empty">Aucune donnée.</div>
              )}
              {board.fastest_players.map((e, i) => (
                <div key={e.username} className="admin-table__row">
                  <span className="admin-col admin-col--id">{i + 1}</span>
                  <span className="admin-col admin-col--name">
                    {e.username}
                  </span>
                  <span className="admin-col admin-col--rank">
                    {formatResponseTime(e.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default StatsPage;
