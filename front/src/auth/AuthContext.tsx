import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchMe, getStoredToken, loginRequest, registerRequest, storeToken, type AuthResponse, type AuthUser } from '../services/auth';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      setLoading(false);
      return;
    }

    setToken(stored);
    fetchMe(stored)
      .then((me) => setUser(me))
      .catch(() => {
        storeToken(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleAuth = useCallback(async (action: () => Promise<AuthResponse>) => {
    setError(null);
    setLoading(true);
    try {
      const response = await action();
      setToken(response.access_token);
      storeToken(response.access_token);
      setUser(response.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => handleAuth(() => loginRequest(email, password)), [handleAuth]);

  const register = useCallback(
    async (email: string, username: string, password: string) => handleAuth(() => registerRequest(email, username, password)),
    [handleAuth],
  );

  const logout = useCallback(() => {
    storeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const me = await fetchMe(token);
      setUser(me);
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextValue = {
    user,
    token,
    loading,
    error,
    login,
    register,
    logout,
    refresh,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('');
  }
  return ctx;
};
