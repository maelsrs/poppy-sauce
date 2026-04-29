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
  user: AuthUser;
};

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8081';

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
    return text;
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
    const networkMsg = "Le serveur est temporairement indisponible. Veuillez réessayer dans quelques instants.";
    return new Error(text || networkMsg);
  }
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path);

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
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

    console.info(`[api] ${method} ${path} -> ${response.status}`);
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[api] ${method} ${path} failed`, error);
    throw error;
  }
}

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

export const fetchMe = async (): Promise<AuthUser> =>
  request<AuthUser>('/auth/me');

export const logoutRequest = async (): Promise<void> => {
  await request<unknown>('/auth/logout', { method: 'POST' });
};
