import type { ReactNode } from 'react';
import { FileText, Gamepad2, Lollipop, User, type LucideIcon } from 'lucide-react';
import './App.css';

type ActionCardProps = {
  title: string;
  icon?: LucideIcon;
  tone: 'blue' | 'purple' | 'slate' | 'teal';
  subIcon: ReactNode;
  onClick?: () => void;
};

const ActionCard = ({ title, icon: Icon, tone, subIcon, onClick }: ActionCardProps) => (
  <button type="button" className={`action-card action-card--${tone}`} onClick={onClick}>
    <span className="action-card__title">{title}</span>

    {Icon ? (
      <span className="action-card__icon" aria-hidden="true">
        <Icon size={72} />
      </span>
    ) : null}

    <span className="action-card__subicon" aria-hidden="true">
      {subIcon}
    </span>
  </button>
);

type StatRowProps = {
  label: string;
  value: string | number;
  unit?: string;
};

const StatRow = ({ label, value, unit = '' }: StatRowProps) => (
  <div className="stat-row">
    <span className="stat-row__label">{label}</span>
    <span className="stat-row__value">
      {value} {unit}
    </span>
  </div>
);

function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <div className="brand">
          <span className="brand__dot" aria-hidden="true" />
          <span className="brand__name">POPPY.SAUCE</span>
        </div>
        <div className="navbar__links">
          <a href="#">Blog / FAQ</a>
          <a href="#">Discord</a>
        </div>
      </nav>

      <div className="hero" aria-hidden="true">
        <div className="hero__shapes">
          <span className="hero__bubble hero__bubble--sm" />
          <span className="hero__bubble hero__bubble--md" />
          <span className="hero__bubble hero__bubble--lg" />
        </div>
        <div className="hero__bar" />
      </div>

      <main className="content">
        <div className="layout">
          <section className="column column--sidebar">
            <div className="profile-card">
              <div className="profile-card__header">
                <span className="avatar" aria-hidden="true">
                  🦁
                </span>
              </div>

              <div className="profile-card__body">
                <h2 className="profile-card__name">gnogno</h2>
                <div className="profile-card__field">GNOGNO</div>
                <button type="button" className="profile-card__button">
                  Gérer
                </button>
              </div>
            </div>

            <div className="stats-card">
              <StatRow label="Âge du compte" value="0" unit="j" />
              <StatRow label="Parties jouées" value="0" />
              <StatRow label="Temps de jeu" value="0mn 0s" />
              <StatRow label="Succès" value="0" />
              <div className="stats-card__footer">
                <span className="stat-row__label">Titre</span>
                <span className="stat-row__value">Membre</span>
              </div>
            </div>
          </section>

          <section className="column column--actions">
            <div className="actions-grid">
              <ActionCard title="Parties publiques" tone="blue" icon={FileText} subIcon={<span>📝</span>} />

              <ActionCard title="Créer une partie" tone="purple" icon={Lollipop} subIcon={<span>🍭</span>} />

              <ActionCard title="Stats" tone="slate" icon={Gamepad2} subIcon={<span>🎮</span>} />

              <ActionCard title="Rejoindre une partie" tone="teal" icon={User} subIcon={<span>👤</span>} />
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">
        <span>⚡ Sparklin Labs</span>
        <a href="#">Blog / FAQ</a>
        <a href="#">Discord</a>
        <a href="#">Conditions</a>
      </footer>
    </div>
  );
}

export default App;
