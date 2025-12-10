import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field } from '../components/ui';

type AuthMode = 'login' | 'register';

function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    const fromQuery = searchParams.get('mode') === 'register' ? 'register' : 'login';
    if (fromQuery !== mode) {
      setMode(fromQuery);
    }
  }, [mode, searchParams]);

  const setModeAndQuery = (next: AuthMode) => {
    setMode(next);
    setSearchParams({ mode: next });
  };

  return (
    <section className="auth">
      <div className="auth__card">
        <div className="account-card__header">
          <p className="account-card__eyebrow">Espace compte</p>
          <h2 className="account-card__title">{mode === 'login' ? 'Connexion' : 'Inscription'}</h2>
          <p className="account-card__hint">
            {mode === 'login'
              ? 'Retrouve tes parties et reprends là où tu t’es arrêté.'
              : 'Crée ton compte pour garder tes stats et tes salons.'}
          </p>
        </div>

        <div className="account-tabs">
          <button
            type="button"
            className={`account-tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => setModeAndQuery('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`account-tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => setModeAndQuery('register')}
          >
            Register
          </button>
        </div>

        <div className="auth__form">
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="poppy@email.com" />
          <Field label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
          {mode === 'register' ? (
            <Field label="Confirmer" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" />
          ) : null}
          <div className="account-panel__actions">
            <button type="button" className="account-card__btn account-card__btn--primary">
              {mode === 'login' ? 'Se connecter' : "S'inscrire"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AuthPage;
