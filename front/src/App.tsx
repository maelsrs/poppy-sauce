import { Link, Route, Routes, useLocation } from 'react-router-dom';
import './App.css';
import HomePage from './pages/Home';
import PublicGamesPage from './pages/PublicGames';
import AuthPage from './pages/Auth';
import LobbyPage from './pages/Lobby';

function App() {
  const location = useLocation();
  const isLobby = location.pathname.startsWith('/lobby');

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
          <a href="#" onClick={(e) => e.preventDefault()}>
            Discord
          </a>
        </div>
      </nav>

      {!isLobby && <div className="hero" aria-hidden="true" />}

      <main className={`content ${isLobby ? 'content--lobby' : ''}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/lobby" element={<LobbyPage />} />
          <Route path="/public-games" element={<PublicGamesPage />} />
          <Route path="*" element={<div className="not-found">Page introuvable</div>} />
        </Routes>
      </main>

      <footer className="footer">
        <a href="#">Discord</a>
      </footer>
    </div>
  );
}

export default App;
