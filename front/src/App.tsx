import { Link, Route, Routes, useLocation } from 'react-router-dom';
import './App.css';
import { useAuth } from './auth/AuthContext';
import AdminPage from './pages/Admin';
import HomePage from './pages/Home';
import PublicGamesPage from './pages/PublicGames';
import AuthPage from './pages/Auth';
import LobbyPage from './pages/Lobby';
import StatsPage from './pages/Stats';

function App() {
  const location = useLocation();
  const { user } = useAuth();
  const isLobby = location.pathname.startsWith('/lobby') || location.pathname.startsWith('/game/');

  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="brand">
          <span className="brand__dot" aria-hidden="true" />
          <span className="brand__name">POPPY.SAUCE</span>
        </Link>
        <div className="navbar__links">
          <Link to="/">Accueil</Link>
          <Link to="/public-games">Parties publiques</Link>
          <a href="" target="_blank" rel="noopener noreferrer">
            Discord
          </a>
          {user?.rank === 'Admin' && <Link to="/admin">Admin</Link>}
        </div>
      </nav>

      {!isLobby && <div className="hero" aria-hidden="true" />}

      <main className={`content ${isLobby ? 'content--lobby' : ''}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/lobby" element={<LobbyPage />} />
          <Route path="/game/:code" element={<LobbyPage />} />
          <Route path="/public-games" element={<PublicGamesPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<div className="not-found">Page introuvable</div>} />
        </Routes>
      </main>

      {!isLobby && (
        <footer className="footer">
          <a href="" target="_blank" rel="noopener noreferrer">
            Discord
          </a>
        </footer>
      )}
    </div>
  );
}

export default App;
