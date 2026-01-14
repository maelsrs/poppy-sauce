export type AuthUser = {
  uuid: string;
  username: string;
  email: string;
  rank: string;
  last_login?: string | null;
  first_login?: string | null;
  level: number;
  playtime: number;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8081';
const TOKEN_KEY = 'poppy.auth.token';

const buildUrl = (path: string) => `${API_BASE}${path}`;

const translateDetail = (text: string): string => {
  const lower = text.toLowerCase();

  if (lower.includes('invalid credentials')) {
    return 'Email ou mot de passe incorrect.';
  }

  if (lower.includes('value is not a valid email address')) {
    return "L'adresse email est invalide.";
  }

  if (lower.includes('ensure this value has at least') || lower.includes('champ trop court') || lower.includes('trop court')) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }

  if (lower.includes('field required') || lower.includes('champ requis')) {
    return 'Merci de remplir tous les champs obligatoires.';
  }

  return text;
};

const parseError = async (response: Response): Promise<Error> => {
  try {
    const data = await response.json();
    const detail = data?.detail ?? data?.message;

    if (typeof detail === 'string') {
      return new Error(translateDetail(detail));
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      const msg = translateDetail(first?.msg || first?.message || 'Erreur de validation');
      return new Error(msg);
    }

    if (response.status === 401) return new Error('Email ou mot de passe incorrect.');
    if (response.status === 409) return new Error('Cette adresse email ou ce pseudo est déjà utilisé.');
    if (response.status === 422) return new Error('Données invalides. Merci de vérifier les champs.');
    return new Error('Une erreur est survenue.');
  } catch {
    const text = await response.text();
    const networkMsg = 'Impossible de contacter le serveur. Vérifie qu’il tourne et que CORS est autorisé.';
    return new Error(text || networkMsg);
  }
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const err = await parseError(response);
      console.error(`[api] ${method} ${path} -> ${response.status}`, err.message);
      throw err;
    }

    const data = (await response.json()) as T;
    console.info(`[api] ${method} ${path} -> ${response.status}`);
    return data;
  } catch (error) {
    console.error(`[api] ${method} ${path} failed`, error);
    throw error;
  }
}

export const getStoredToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const storeToken = (token: string | null) => {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
};

export const registerRequest = async (email: string, username: string, password: string): Promise<AuthResponse> =>
  request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });

export const loginRequest = async (email: string, password: string): Promise<AuthResponse> =>
  request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const fetchMe = async (token: string): Promise<AuthUser> =>
  request<AuthUser>('/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
