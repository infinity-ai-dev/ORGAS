import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, AuthUser, setAuthSession, getAuthSession, clearAuthSession } from '@/lib/api';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  completeMagicLink: (token: string) => Promise<{ error: Error | null }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getAuthSession();
    setUser(session?.user || null);
    setToken(session?.token || null);
    setLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const requireHandshake = (import.meta.env.VITE_REQUIRE_HANDSHAKE || 'false') === 'true';
      let handshakeToken: string | undefined;

      if (requireHandshake) {
        const handshakeResponse = await apiFetch<{ handshakeToken: string }>(
          '/auth/handshake',
          { method: 'GET', skipAuth: true }
        );
        handshakeToken = handshakeResponse.handshakeToken;
      }

      const response = await apiFetch<{
        success: boolean;
        user: AuthUser;
        token: string;
        error?: string;
      }>('/auth/login', {
        method: 'POST',
        body: {
          email,
          password,
          handshakeToken
        },
        skipAuth: true
      });

      if (!response?.success || !response.token || !response.user) {
        return { error: new Error(response?.error || 'Falha ao autenticar') };
      }

      setAuthSession({ token: response.token, user: response.user });
      setUser(response.user);
      setToken(response.token);
      return { error: null };
    } catch (error: any) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  };

  const completeMagicLink = async (magicToken: string) => {
    try {
      const response = await apiFetch<{
        success: boolean;
        user: AuthUser;
        token: string;
        error?: string;
      }>('/auth/magic-link/consume', {
        method: 'POST',
        body: {
          token: magicToken,
        },
        skipAuth: true
      });

      if (!response?.success || !response.token || !response.user) {
        return { error: new Error(response?.error || 'Falha ao consumir magic link') };
      }

      setAuthSession({ token: response.token, user: response.user });
      setUser(response.user);
      setToken(response.token);
      return { error: null };
    } catch (error: any) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  };

  const resetPassword = async (resetToken: string, newPassword: string) => {
    try {
      const response = await apiFetch<{
        success: boolean;
        error?: string;
      }>('/auth/reset-password', {
        method: 'POST',
        body: {
          token: resetToken,
          newPassword,
        },
        skipAuth: true
      });

      if (!response?.success) {
        return { error: new Error(response?.error || 'Falha ao redefinir senha') };
      }

      return { error: null };
    } catch (error: any) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  };

  const signUp = async () => {
    return { error: new Error('Cadastro não disponível via backend no momento.') };
  };

  const signOut = async () => {
    clearAuthSession();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, signIn, completeMagicLink, resetPassword, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
