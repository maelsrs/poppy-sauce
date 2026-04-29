import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/ui";

type AuthMode = "login" | "register";

function AuthPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { login, register, loading, error, user, clearError } = useAuth();

  const initialMode =
    searchParams.get("mode") === "register" ? "register" : "login";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery =
      searchParams.get("mode") === "register" ? "register" : "login";
    if (fromQuery !== mode) {
      setMode(fromQuery);
      setFormError(null);
      clearError();
    }
  }, [mode, searchParams, clearError]);

  useEffect(() => {
    if (!loading && user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  const setModeAndQuery = (next: AuthMode) => {
    setMode(next);
    setSearchParams({ mode: next });
  };

  const handleSubmit = async () => {
    setFormError(null);
    clearError();
    if (mode === "register" && password !== confirm) {
      setFormError("Les mots de passe ne correspondent pas.");
      return;
    }

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, username, password);
      }
      navigate("/");
    } catch (err) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Une erreur s'est produite.");
      }
    }
  };

  const isSubmitDisabled =
    loading ||
    !email.trim() ||
    !password.trim() ||
    (mode === "register" && (!username.trim() || !confirm.trim()));

  return (
    <section className="auth">
      <div className="auth__card">
        <div className="account-card__header">
          <p className="account-card__eyebrow">Espace compte</p>
          <h2 className="account-card__title">
            {mode === "login" ? "Connexion" : "Inscription"}
          </h2>
          <p className="account-card__hint">
            {mode === "login"
              ? "Retrouve tes parties et reprends là où tu t’es arrêté."
              : "Crée ton compte pour garder tes stats et tes salons."}
          </p>
        </div>

        <div className="account-tabs">
          <button
            type="button"
            className={`account-tab ${mode === "login" ? "is-active" : ""}`}
            onClick={() => setModeAndQuery("login")}
            disabled={loading}
          >
            Login
          </button>
          <button
            type="button"
            className={`account-tab ${mode === "register" ? "is-active" : ""}`}
            onClick={() => setModeAndQuery("register")}
            disabled={loading}
          >
            Register
          </button>
        </div>

        <form
          className="auth__form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="poppy@email.com"
          />
          {mode === "register" ? (
            <Field
              label="Pseudo"
              value={username}
              onChange={setUsername}
              placeholder="PoppyPlayer"
            />
          ) : null}
          <Field
            label="Mot de passe"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
          {mode === "register" ? (
            <Field
              label="Confirmer"
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
            />
          ) : null}

          {(formError || error) && (
            <div className="auth__error">{formError ?? error}</div>
          )}

          <div className="account-panel__actions">
            <button
              type="submit"
              className="account-card__btn account-card__btn--primary"
              disabled={isSubmitDisabled}
            >
              {loading
                ? "Patiente..."
                : mode === "login"
                  ? "Se connecter"
                  : "S'inscrire"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default AuthPage;
