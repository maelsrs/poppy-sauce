import { useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '../components/ui';

// --- Types ---
type CategoryMode = 'uniquement' | 'enlever';

type Category = {
  id: string;
  name: string;
  mode: CategoryMode;
};

const sampleCategories: Category[] = [
  { id: '1', name: 'Culture pop', mode: 'uniquement' },
  { id: '2', name: 'Histoire', mode: 'enlever' },
];

const CATEGORY_POOL = [
  'Culture pop',
  'Histoire',
  'Sciences',
  'Géographie',
  'Cinéma',
  'Technologie',
  'Sport',
  'Musique',
  'Littérature',
  'Cuisine',
  'Animaux',
  'Art',
  'Jeux vidéo',
  'Nature',
  'Mythologie',
  'Voyages',
];

const players = [
  { id: 'p1', name: 'Alex', host: true },
  { id: 'p2', name: 'Sam' },
  { id: 'p3', name: 'Lise' },
  { id: 'p4', name: 'Rayan' },
  { id: 'p5', name: 'Nora' },
  { id: 'p6', name: 'Thomas' },
];

// --- Icons (SVG Inline pour être "carré" et propre) ---
const IconGear = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

const IconClose = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const clampInput = (value: string, min: number, max: number, fallback: number) => {
  if (value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

function LobbyPage() {
  const [configOpen, setConfigOpen] = useState(true);
  const [targetScore, setTargetScore] = useState(100);
  const [targetScoreDraft, setTargetScoreDraft] = useState('100');
  const [duration, setDuration] = useState(20);
  const [durationDraft, setDurationDraft] = useState('20');
  const [rounds, setRounds] = useState(1);
  const [roundsDraft, setRoundsDraft] = useState('1');
  const [categories, setCategories] = useState<Category[]>(sampleCategories);
  const [categoryInput, setCategoryInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleMode = (id: string) => {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id === id ? { ...cat, mode: cat.mode === 'uniquement' ? 'enlever' : 'uniquement' } : cat,
      ),
    );
  };

  const removeCategory = (id: string) => setCategories((prev) => prev.filter((cat) => cat.id !== id));

  const addCategoryFromName = (name: string) => {
    setCategories((prev) => {
      if (prev.some((cat) => cat.name.toLowerCase() === name.toLowerCase())) {
        return prev;
      }
      return [...prev, { id: crypto.randomUUID(), name, mode: 'uniquement' }];
    });
    setCategoryInput('');
  };

  const addCategory = () => {
    if (!categoryInput.trim()) return;
    const trimmed = categoryInput.trim();
    addCategoryFromName(trimmed);
    setDropdownOpen(false);
  };

  const categoryCount = useMemo(() => categories.length, [categories]);
  const availableCategories = useMemo(() => {
    const normalized = categoryInput.trim().toLowerCase();
    return CATEGORY_POOL.filter(
      (name) => !categories.some((cat) => cat.name.toLowerCase() === name.toLowerCase()),
    ).filter((name) => (!normalized ? true : name.toLowerCase().includes(normalized)));
  }, [categories, categoryInput]);

  const handleSuggestionClick = (name: string) => {
    addCategoryFromName(name);
    setDropdownOpen(false);
  };

  const openDropdown = () => setDropdownOpen(true);

  const handleTargetBlur = () => {
    const clamped = clampInput(targetScoreDraft, 10, 1500, targetScore);
    setTargetScore(clamped);
    setTargetScoreDraft(String(clamped));
  };

  const handleDurationBlur = () => {
    const clamped = clampInput(durationDraft, 5, 60, duration);
    setDuration(clamped);
    setDurationDraft(String(clamped));
  };

  const handleRoundsBlur = () => {
    const clamped = clampInput(roundsDraft, 1, 50, rounds);
    setRounds(clamped);
    setRoundsDraft(String(clamped));
  };

  return (
    <div className={`lobby-shell ${configOpen ? 'is-config-open' : 'is-config-closed'}`}>
      
      {/* --- COLONNE DE GAUCHE : CONFIGURATION --- */}
      <aside className="lobby-sidebar config-pane">
        <div className="sidebar-header">
          {configOpen ? (
            <>
              <div className="header-title">
                <span className="eyebrow">ADMIN</span>
                <h3>Paramètres</h3>
              </div>
              <button 
                type="button" 
                className="btn-icon-square" 
                onClick={() => setConfigOpen(false)}
                title="Fermer la configuration"
              >
                <IconChevronLeft />
              </button>
            </>
          ) : (
            <button 
              type="button" 
              className="btn-icon-square main-toggle" 
              onClick={() => setConfigOpen(true)}
              title="Ouvrir la configuration"
            >
              <IconGear />
            </button>
          )}
        </div>

        {/* Contenu scrollable masqué si fermé */}
        <div className={`config-scroller ${!configOpen ? 'hidden' : ''}`}>
          <div className="config-group">
            <h4 className="group-title">Règles</h4>
            <div className="fields-grid">
              <Field
                label="Objectif"
                type="number"
                value={targetScoreDraft}
                onChange={setTargetScoreDraft}
                onBlur={handleTargetBlur}
                placeholder="100"
              />
              <Field
                label="Temps (s)"
                type="number"
                value={durationDraft}
                onChange={setDurationDraft}
                onBlur={handleDurationBlur}
                placeholder="20"
              />
              <Field
                label="Rounds"
                type="number"
                value={roundsDraft}
                onChange={setRoundsDraft}
                onBlur={handleRoundsBlur}
                placeholder="1"
              />
            </div>
          </div>

          <div className="config-group">
            <div className="group-header">
              <h4 className="group-title">Catégories</h4>
              <span className="badge-count">{categoryCount}</span>
            </div>
            
            <div className="category-list">
              {categories.map((cat) => (
                <div key={cat.id} className="category-item">
                  <span className="cat-name">{cat.name}</span>
                  <div className="cat-actions">
                    <button
                      type="button"
                      className={`btn-mode ${cat.mode}`}
                      onClick={() => toggleMode(cat.id)}
                    >
                      {cat.mode === 'uniquement' ? 'UNIQUEMENT' : 'EXCLURE'}
                    </button>
                    <button type="button" className="btn-remove" onClick={() => removeCategory(cat.id)}>
                      X
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="add-category" ref={dropdownRef}>
              <input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder="Nouvelle catégorie..."
                onFocus={openDropdown}
                onClick={openDropdown}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              />
              <button type="button" onClick={addCategory}>+</button>
              {dropdownOpen ? (
                <div className="category-suggestions">
                  {availableCategories.length > 0 ? (
                    availableCategories.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="category-suggestions__item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSuggestionClick(name)}
                      >
                        {name}
                      </button>
                    ))
                  ) : (
                    <div className="category-suggestions__empty">Aucune catégorie disponible</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

        </div>
      </aside>

      {/* --- COLONNE CENTRALE : JEU --- */}
      <main className="lobby-stage">
        <div className="stage-content">
          <div className="placeholder-box">
            <span className="status-dot pulsing" />
            <h2>En attente de lancement</h2>
            <p>L'hôte configure la partie...</p>
          </div>
        </div>
        
        <div className="stage-footer">
          <button type="button" className="btn-join">
            PRÊT À JOUER
          </button>
        </div>
      </main>

      {/* --- COLONNE DE DROITE : JOUEURS & CHAT --- */}
      <aside className="lobby-sidebar players-pane">
        <div className="sidebar-section players-list-section">
          <div className="section-header">
            <h4>JOUEURS <span className="dimmed">({players.length})</span></h4>
          </div>
          <div className="players-grid">
            {players.map((player) => (
              <div key={player.id} className="player-row">
                <div className={`avatar ${player.host ? 'host' : ''}`}>
                  {player.name.charAt(0)}
                </div>
                <span className="player-name">{player.name}</span>
                {player.host && <span className="host-badge">Hôte</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section chat-section">
          <div className="section-header">
            <h4>MESSAGES</h4>
          </div>
          <div className="chat-box">
             <div className="msg">
               <span className="msg-author">Alex:</span>
               <span className="msg-content">On commence ?</span>
             </div>
             <div className="msg">
               <span className="msg-author">Sam:</span>
               <span className="msg-content">Attends j'arrive !</span>
             </div>
          </div>
          <div className="chat-input-area">
            <input type="text" placeholder="Envoyer un message..." />
          </div>
        </div>
      </aside>

    </div>
  );
}

export default LobbyPage;
