import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getStoredToken, request } from '../services/auth';

type PaginatedUsers = {
  items: {
    uuid: string;
    username: string;
    rank: string;
    last_login: string | null;
    first_login: string | null;
    level: number;
    playtime: number;
  }[];
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
  image_url: string | null;
};

type PaginatedQuestions = {
  items: QuestionItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

type Tab = 'users' | 'questions';

function AdminPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<Tab>('users');
  const [usersData, setUsersData] = useState<PaginatedUsers | null>(null);
  const [questionsData, setQuestionsData] = useState<PaginatedQuestions | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [questionPage, setQuestionPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.rank !== 'Admin')) {
      navigate('/');
    }
  }, [authLoading, user, navigate]);

  const authHeaders = (): HeadersInit => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    if (!user || user.rank !== 'Admin') return;
    setLoading(true);
    request<PaginatedUsers>(`/admin/users?page=${userPage}&per_page=20`, { headers: authHeaders() })
      .then(setUsersData)
      .finally(() => setLoading(false));
  }, [userPage, user]);

  useEffect(() => {
    if (!user || user.rank !== 'Admin') return;
    request<string[]>('/admin/questions/categories', { headers: authHeaders() }).then(setCategories);
  }, [user]);

  useEffect(() => {
    if (!user || user.rank !== 'Admin') return;
    setLoading(true);
    const catParam = selectedCategory ? `&category=${encodeURIComponent(selectedCategory)}` : '';
    request<PaginatedQuestions>(`/admin/questions?page=${questionPage}&per_page=20${catParam}`, {
      headers: authHeaders(),
    })
      .then(setQuestionsData)
      .finally(() => setLoading(false));
  }, [questionPage, selectedCategory, user]);

  if (authLoading || !user || user.rank !== 'Admin') return null;

  return (
    <div className="layout">
      <section className="column column--sidebar">
        <div className="admin-nav">
          <p className="admin-nav__eyebrow">Administration</p>
          <h2 className="admin-nav__title">Panneau admin</h2>

          <div className="admin-tabs">
            <button
              type="button"
              className={`admin-tab ${tab === 'users' ? 'is-active' : ''}`}
              onClick={() => setTab('users')}
            >
              Utilisateurs
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'questions' ? 'is-active' : ''}`}
              onClick={() => setTab('questions')}
            >
              Questions
            </button>
          </div>
        </div>

        {tab === 'questions' && (
          <div className="admin-categories">
            <p className="admin-categories__label">Catégories</p>
            <div className="admin-category-list">
              <button
                type="button"
                className={`admin-category-item ${selectedCategory === null ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedCategory(null);
                  setQuestionPage(1);
                }}
              >
                Toutes
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`admin-category-item ${selectedCategory === cat ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setQuestionPage(1);
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'users' && usersData && (
          <div className="admin-stats-card">
            <div className="stat-row">
              <span className="stat-row__label">Total utilisateurs</span>
              <span className="stat-row__value">{usersData.total}</span>
            </div>
          </div>
        )}

        {tab === 'questions' && questionsData && (
          <div className="admin-stats-card">
            <div className="stat-row">
              <span className="stat-row__label">Total questions</span>
              <span className="stat-row__value">{questionsData.total}</span>
            </div>
            <div className="stat-row">
              <span className="stat-row__label">Catégories</span>
              <span className="stat-row__value">{categories.length}</span>
            </div>
          </div>
        )}
      </section>

      <section className="column column--actions">
        <div className="admin-list-card">
          <div className="admin-list-header">
            <h3 className="admin-list-header__title">
              {tab === 'users' ? 'Utilisateurs' : 'Questions'}
            </h3>
            {tab === 'questions' && selectedCategory && (
              <span className="admin-filter-badge">{selectedCategory}</span>
            )}
          </div>

          {loading ? (
            <div className="admin-loading">Chargement...</div>
          ) : tab === 'users' && usersData ? (
            <>
              <div className="admin-table">
                <div className="admin-table__head">
                  <span className="admin-col admin-col--name">Pseudo</span>
                  <span className="admin-col admin-col--rank">Rang</span>
                  <span className="admin-col admin-col--level">Niveau</span>
                  <span className="admin-col admin-col--date">Dernière connexion</span>
                </div>
                {usersData.items.map((u) => (
                  <div key={u.uuid} className="admin-table__row">
                    <span className="admin-col admin-col--name">{u.username}</span>
                    <span className={`admin-col admin-col--rank ${u.rank === 'Admin' ? 'admin-rank--admin' : ''}`}>
                      {u.rank}
                    </span>
                    <span className="admin-col admin-col--level">{u.level}</span>
                    <span className="admin-col admin-col--date">
                      {u.last_login ? u.last_login.slice(0, 10) : '-'}
                    </span>
                  </div>
                ))}
                {usersData.items.length === 0 && (
                  <div className="admin-empty">Aucun utilisateur.</div>
                )}
              </div>
              <Pagination page={usersData.page} pages={usersData.pages} onChange={setUserPage} />
            </>
          ) : tab === 'questions' && questionsData ? (
            <>
              <div className="admin-table">
                <div className="admin-table__head">
                  <span className="admin-col admin-col--id">#</span>
                  <span className="admin-col admin-col--question">Question</span>
                  <span className="admin-col admin-col--cat">Catégorie</span>
                  <span className="admin-col admin-col--answers">Réponses</span>
                </div>
                {questionsData.items.map((q) => (
                  <div key={q.question_id} className="admin-table__row">
                    <span className="admin-col admin-col--id">{q.question_id}</span>
                    <span className="admin-col admin-col--question">{q.question}</span>
                    <span className="admin-col admin-col--cat">{q.category}</span>
                    <span className="admin-col admin-col--answers">{q.answers.join(', ') || '-'}</span>
                  </div>
                ))}
                {questionsData.items.length === 0 && (
                  <div className="admin-empty">Aucune question.</div>
                )}
              </div>
              <Pagination page={questionsData.page} pages={questionsData.pages} onChange={setQuestionPage} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;

  const items: (number | '...')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= page - 1 && i <= page + 1)) {
      items.push(i);
    } else if (items[items.length - 1] !== '...') {
      items.push('...');
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
        item === '...' ? (
          <span key={`e${idx}`} className="admin-page-ellipsis">...</span>
        ) : (
          <button
            key={item}
            type="button"
            className={`admin-page-btn ${item === page ? 'is-active' : ''}`}
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
