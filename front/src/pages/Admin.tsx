import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { request } from "../services/auth";
import { Field, Modal } from "../components/ui";

type UserItem = {
  uuid: string;
  username: string;
  email?: string;
  rank: string;
  last_login: string | null;
  first_login: string | null;
  level: number;
  playtime: number;
  games_played: number;
  wins: number;
  correct_answers: number;
  total_answers: number;
  best_score: number;
};

type PaginatedUsers = {
  items: UserItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

type QuestionItem = {
  question_id: number;
  question_type: string;
  category: string;
  question: string;
  answers: string[];
  description: string | null;
  image_url: string | null;
};

type PaginatedQuestions = {
  items: QuestionItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

type CategoryStat = {
  name: string;
  count: number;
};

type QuestionStats = {
  total: number;
  categories: CategoryStat[];
};

type RankStat = {
  name: string;
  count: number;
};

type UserStats = {
  total: number;
  ranks: RankStat[];
};

type Tab = "users" | "questions";

function AdminPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<Tab>("users");
  const [usersData, setUsersData] = useState<PaginatedUsers | null>(null);
  const [questionsData, setQuestionsData] = useState<PaginatedQuestions | null>(
    null,
  );
  const [stats, setStats] = useState<QuestionStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRank, setSelectedRank] = useState<string | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [questionPage, setQuestionPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Edit/Delete user
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editRank, setEditRank] = useState("");
  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null);

  // Create/Edit/Delete/View question
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionItem | null>(
    null,
  );
  const [viewingQuestion, setViewingQuestion] = useState<QuestionItem | null>(
    null,
  );
  const [deletingQuestion, setDeletingQuestion] = useState<QuestionItem | null>(
    null,
  );
  const [qQuestion, setQQuestion] = useState("");
  const [qAnswers, setQAnswers] = useState("");
  const [qCategory, setQCategory] = useState("");
  const [qDescription, setQDescription] = useState("");
  const [qImageUrl, setQImageUrl] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.rank !== "Admin")) {
      navigate("/");
    }
  }, [authLoading, user, navigate]);

  const loadUsers = () => {
    if (!user || user.rank !== "Admin") return;
    setLoading(true);
    const rankParam = selectedRank
      ? `&rank=${encodeURIComponent(selectedRank)}`
      : "";
    request<PaginatedUsers>(
      `/admin/users?page=${userPage}&per_page=20${rankParam}`,
    )
      .then(setUsersData)
      .finally(() => setLoading(false));
  };

  const loadUserStats = () => {
    if (!user || user.rank !== "Admin") return;
    request<UserStats>("/admin/users/stats").then(setUserStats);
  };

  const loadQuestions = () => {
    if (!user || user.rank !== "Admin") return;
    setLoading(true);
    const catParam = selectedCategory
      ? `&category=${encodeURIComponent(selectedCategory)}`
      : "";
    request<PaginatedQuestions>(
      `/admin/questions?page=${questionPage}&per_page=20${catParam}`,
    )
      .then(setQuestionsData)
      .finally(() => setLoading(false));
  };

  const loadStats = () => {
    if (!user || user.rank !== "Admin") return;
    request<QuestionStats>("/admin/questions/stats").then(setStats);
  };

  useEffect(() => {
    if (tab !== "users") return;
    loadUsers();
  }, [tab, userPage, selectedRank, user]);

  useEffect(() => {
    if (tab !== "users") return;
    loadUserStats();
  }, [tab, user]);

  useEffect(() => {
    if (tab !== "questions") return;
    loadStats();
  }, [tab, user]);

  useEffect(() => {
    if (tab !== "questions") return;
    loadQuestions();
  }, [tab, questionPage, selectedCategory, user]);

  const openEditUser = (u: UserItem) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditRank(u.rank);
  };

  const saveUser = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      await request(`/admin/users/${editingUser.uuid}`, {
        method: "PUT",
        body: JSON.stringify({ username: editUsername, rank: editRank }),
      });
      setEditingUser(null);
      loadUsers();
      loadUserStats();
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deletingUser) return;
    setSaving(true);
    try {
      await request(`/admin/users/${deletingUser.uuid}`, { method: "DELETE" });
      setDeletingUser(null);
      loadUsers();
      loadUserStats();
    } finally {
      setSaving(false);
    }
  };

  const openCreateQuestion = () => {
    setQQuestion("");
    setQAnswers("");
    setQCategory("Grand public");
    setQDescription("");
    setQImageUrl("");
    setShowCreateQuestion(true);
  };

  const openEditQuestion = (q: QuestionItem) => {
    setEditingQuestion(q);
    setQQuestion(q.question);
    setQAnswers(q.answers.join(", "));
    setQCategory(q.category);
    setQDescription(q.description ?? "");
    setQImageUrl(q.image_url ?? "");
  };

  const saveNewQuestion = async () => {
    setSaving(true);
    try {
      await request("/admin/questions", {
        method: "POST",
        body: JSON.stringify({
          question: qQuestion,
          answers: qAnswers
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
          category: qCategory || "Grand public",
          description: qDescription || null,
          image_url: qImageUrl || null,
        }),
      });
      setShowCreateQuestion(false);
      loadQuestions();
      loadStats();
    } finally {
      setSaving(false);
    }
  };

  const saveEditQuestion = async () => {
    if (!editingQuestion) return;
    setSaving(true);
    try {
      await request(`/admin/questions/${editingQuestion.question_id}`, {
        method: "PUT",
        body: JSON.stringify({
          question: qQuestion,
          answers: qAnswers
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
          category: qCategory || "Grand public",
          description: qDescription || null,
          image_url: qImageUrl || null,
        }),
      });
      setEditingQuestion(null);
      loadQuestions();
      loadStats();
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteQuestion = async () => {
    if (!deletingQuestion) return;
    setSaving(true);
    try {
      await request(`/admin/questions/${deletingQuestion.question_id}`, {
        method: "DELETE",
      });
      setDeletingQuestion(null);
      loadQuestions();
      loadStats();
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user || user.rank !== "Admin") return null;

  return (
    <div className="layout">
      <section className="column column--sidebar">
        <div className="admin-nav">
          <p className="admin-nav__eyebrow">Administration</p>
          <h2 className="admin-nav__title">Panneau admin</h2>

          <div className="admin-tabs">
            <button
              type="button"
              className={`admin-tab ${tab === "users" ? "is-active" : ""}`}
              onClick={() => setTab("users")}
            >
              Utilisateurs
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === "questions" ? "is-active" : ""}`}
              onClick={() => setTab("questions")}
            >
              Questions
            </button>
          </div>
        </div>

        {tab === "questions" && (
          <div className="admin-categories">
            <p className="admin-categories__label">Catégories</p>
            <div className="admin-category-list">
              <button
                type="button"
                className={`admin-category-item ${selectedCategory === null ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedCategory(null);
                  setQuestionPage(1);
                }}
              >
                <span>Toutes</span>
                {stats && (
                  <span className="admin-category-count">{stats.total}</span>
                )}
              </button>
              {stats?.categories.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  className={`admin-category-item ${selectedCategory === cat.name ? "is-active" : ""}`}
                  onClick={() => {
                    setSelectedCategory(cat.name);
                    setQuestionPage(1);
                  }}
                >
                  <span>{cat.name}</span>
                  <span className="admin-category-count">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "users" && (
          <div className="admin-categories">
            <p className="admin-categories__label">Rangs</p>
            <div className="admin-category-list">
              <button
                type="button"
                className={`admin-category-item ${selectedRank === null ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedRank(null);
                  setUserPage(1);
                }}
              >
                <span>Tous</span>
                {userStats && (
                  <span className="admin-category-count">
                    {userStats.total}
                  </span>
                )}
              </button>
              {userStats?.ranks.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  className={`admin-category-item ${selectedRank === r.name ? "is-active" : ""}`}
                  onClick={() => {
                    setSelectedRank(r.name);
                    setUserPage(1);
                  }}
                >
                  <span>{r.name}</span>
                  <span className="admin-category-count">{r.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "users" && userStats && (
          <div className="admin-stats-card">
            <div className="stat-row">
              <span className="stat-row__label">Total utilisateurs</span>
              <span className="stat-row__value">{userStats.total}</span>
            </div>
            {selectedRank && usersData && (
              <div className="stat-row">
                <span className="stat-row__label">Filtrés</span>
                <span className="stat-row__value">{usersData.total}</span>
              </div>
            )}
          </div>
        )}

        {tab === "questions" && stats && (
          <div className="admin-stats-card">
            <div className="stat-row">
              <span className="stat-row__label">Total questions</span>
              <span className="stat-row__value">{stats.total}</span>
            </div>
            <div className="stat-row">
              <span className="stat-row__label">Catégories</span>
              <span className="stat-row__value">{stats.categories.length}</span>
            </div>
            {selectedCategory && questionsData && (
              <div className="stat-row">
                <span className="stat-row__label">Filtrées</span>
                <span className="stat-row__value">{questionsData.total}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="column column--actions">
        <div className="admin-list-card">
          <div className="admin-list-header">
            <h3 className="admin-list-header__title">
              {tab === "users" ? "Utilisateurs" : "Questions"}
            </h3>
            {tab === "questions" && (
              <button
                type="button"
                className="public__create"
                onClick={openCreateQuestion}
              >
                Ajouter
              </button>
            )}
            {tab === "questions" && selectedCategory && (
              <span className="admin-filter-badge">{selectedCategory}</span>
            )}
          </div>

          {loading ? (
            <div className="admin-loading">Chargement...</div>
          ) : tab === "users" && usersData ? (
            <>
              <div className="admin-table">
                <div className="admin-table__head">
                  <span className="admin-col admin-col--name">Pseudo</span>
                  <span className="admin-col admin-col--rank">Rang</span>
                  <span className="admin-col admin-col--level">Parties</span>
                  <span className="admin-col admin-col--date">Actions</span>
                </div>
                {usersData.items.map((u) => (
                  <div key={u.uuid} className="admin-table__row">
                    <span className="admin-col admin-col--name">
                      {u.username}
                    </span>
                    <span
                      className={`admin-col admin-col--rank ${u.rank === "Admin" ? "admin-rank--admin" : ""}`}
                    >
                      {u.rank}
                    </span>
                    <span className="admin-col admin-col--level">
                      {u.games_played}
                    </span>
                    <span className="admin-col admin-col--date">
                      <button
                        type="button"
                        className="admin-action-btn"
                        onClick={() => openEditUser(u)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="admin-action-btn admin-action-btn--danger"
                        onClick={() => setDeletingUser(u)}
                      >
                        Supprimer
                      </button>
                    </span>
                  </div>
                ))}
                {usersData.items.length === 0 && (
                  <div className="admin-empty">Aucun utilisateur.</div>
                )}
              </div>
              <Pagination
                page={usersData.page}
                pages={usersData.pages}
                onChange={setUserPage}
              />
            </>
          ) : tab === "questions" && questionsData ? (
            <>
              <div className="admin-table">
                <div className="admin-table__head">
                  <span className="admin-col admin-col--id">#</span>
                  <span className="admin-col admin-col--question">
                    Question
                  </span>
                  <span className="admin-col admin-col--cat">Catégorie</span>
                  <span className="admin-col admin-col--date">Actions</span>
                </div>
                {questionsData.items.map((q) => (
                  <div key={q.question_id} className="admin-table__row">
                    <span className="admin-col admin-col--id">
                      {q.question_id}
                    </span>
                    <span className="admin-col admin-col--question">
                      {q.question}
                    </span>
                    <span className="admin-col admin-col--cat">
                      {q.category}
                    </span>
                    <span className="admin-col admin-col--date">
                      <button
                        type="button"
                        className="admin-action-btn admin-action-btn--icon"
                        onClick={() => setViewingQuestion(q)}
                        aria-label="Voir"
                        title="Voir"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="admin-action-btn"
                        onClick={() => openEditQuestion(q)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="admin-action-btn admin-action-btn--danger"
                        onClick={() => setDeletingQuestion(q)}
                      >
                        Supprimer
                      </button>
                    </span>
                  </div>
                ))}
                {questionsData.items.length === 0 && (
                  <div className="admin-empty">Aucune question.</div>
                )}
              </div>
              <Pagination
                page={questionsData.page}
                pages={questionsData.pages}
                onChange={setQuestionPage}
              />
            </>
          ) : null}
        </div>
      </section>

      {editingUser && (
        <Modal
          title={`Modifier ${editingUser.username}`}
          onClose={() => setEditingUser(null)}
        >
          <Field
            label="Pseudo"
            value={editUsername}
            onChange={setEditUsername}
          />
          <div className="field">
            <span className="field__label">Rang</span>
            <div className="account-tabs">
              <button
                type="button"
                className={`account-tab ${editRank === "User" ? "is-active" : ""}`}
                onClick={() => setEditRank("User")}
              >
                User
              </button>
              <button
                type="button"
                className={`account-tab ${editRank === "Admin" ? "is-active" : ""}`}
                onClick={() => setEditRank("Admin")}
              >
                Admin
              </button>
            </div>
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setEditingUser(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={saveUser}
              disabled={saving}
            >
              Sauvegarder
            </button>
          </div>
        </Modal>
      )}

      {deletingUser && (
        <Modal
          title="Supprimer un utilisateur"
          onClose={() => setDeletingUser(null)}
        >
          <p>
            Supprimer <strong>{deletingUser.username}</strong> ? Cette action
            est irréversible.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setDeletingUser(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={confirmDeleteUser}
              disabled={saving}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}

      {showCreateQuestion && (
        <Modal
          title="Ajouter une question"
          onClose={() => setShowCreateQuestion(false)}
        >
          <Field
            label="Question"
            value={qQuestion}
            onChange={setQQuestion}
            placeholder="Quelle est la capitale..."
          />
          <Field
            label="Réponses (séparées par des virgules)"
            value={qAnswers}
            onChange={setQAnswers}
            placeholder="Paris, paris"
          />
          <Field
            label="Catégorie"
            value={qCategory}
            onChange={setQCategory}
            placeholder="Grand public"
          />
          <Field
            label="Description (optionnel)"
            value={qDescription}
            onChange={setQDescription}
            placeholder=""
          />
          <Field
            label="URL image (optionnel)"
            value={qImageUrl}
            onChange={setQImageUrl}
            placeholder="https://..."
          />
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setShowCreateQuestion(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={saveNewQuestion}
              disabled={saving || !qQuestion.trim() || !qAnswers.trim()}
            >
              Ajouter
            </button>
          </div>
        </Modal>
      )}

      {editingQuestion && (
        <Modal
          title={`Modifier question #${editingQuestion.question_id}`}
          onClose={() => setEditingQuestion(null)}
        >
          <Field label="Question" value={qQuestion} onChange={setQQuestion} />
          <Field
            label="Réponses (séparées par des virgules)"
            value={qAnswers}
            onChange={setQAnswers}
          />
          <Field label="Catégorie" value={qCategory} onChange={setQCategory} />
          <Field
            label="Description (optionnel)"
            value={qDescription}
            onChange={setQDescription}
          />
          <Field
            label="URL image (optionnel)"
            value={qImageUrl}
            onChange={setQImageUrl}
          />
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setEditingQuestion(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={saveEditQuestion}
              disabled={saving || !qQuestion.trim() || !qAnswers.trim()}
            >
              Sauvegarder
            </button>
          </div>
        </Modal>
      )}

      {viewingQuestion && (
        <Modal
          title={`Question #${viewingQuestion.question_id}`}
          onClose={() => setViewingQuestion(null)}
        >
          <div className="question-view">
            <div className="question-view__category">
              {viewingQuestion.category}
            </div>
            <p className="question-view__question">{viewingQuestion.question}</p>
            {viewingQuestion.image_url && (
              <img
                src={viewingQuestion.image_url}
                alt=""
                className="question-view__image"
              />
            )}
            <div className="question-view__section">
              <span className="question-view__label">Réponses</span>
              <div className="question-view__answers">
                {viewingQuestion.answers.map((a, i) => (
                  <span key={i} className="question-view__answer">
                    {a}
                  </span>
                ))}
              </div>
            </div>
            {viewingQuestion.description && (
              <div className="question-view__section">
                <span className="question-view__label">Description</span>
                <p className="question-view__description">
                  {viewingQuestion.description}
                </p>
              </div>
            )}
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setViewingQuestion(null)}
            >
              Fermer
            </button>
          </div>
        </Modal>
      )}

      {deletingQuestion && (
        <Modal
          title="Supprimer une question"
          onClose={() => setDeletingQuestion(null)}
        >
          <p>
            Supprimer la question{" "}
            <strong>#{deletingQuestion.question_id}</strong> ? Cette action est
            irréversible.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="account-card__btn account-card__btn--ghost"
              onClick={() => setDeletingQuestion(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="account-card__btn account-card__btn--primary"
              onClick={confirmDeleteQuestion}
              disabled={saving}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return null;

  const items: (number | "...")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= page - 1 && i <= page + 1)) {
      items.push(i);
    } else if (items[items.length - 1] !== "...") {
      items.push("...");
    }
  }

  return (
    <div className="admin-pagination">
      <button
        type="button"
        className="admin-page-btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        &laquo;
      </button>
      {items.map((item, idx) =>
        item === "..." ? (
          <span key={`e${idx}`} className="admin-page-ellipsis">
            ...
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`admin-page-btn ${item === page ? "is-active" : ""}`}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className="admin-page-btn"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        &raquo;
      </button>
    </div>
  );
}

export default AdminPage;
