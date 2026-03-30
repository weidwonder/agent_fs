import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, setTokens, clearTokens } from '../api/client.js';

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  tenantId: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, tenantName: string) => Promise<void>;
  logout: () => void;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

interface JwtPayload {
  userId: string;
  tenantId: string;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]!)) as JwtPayload;
        setUserId(payload.userId);
        setTenantId(payload.tenantId);
      } catch {
        clearTokens();
      }
    }
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const data = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(data.accessToken, data.refreshToken);
    setUserId(data.userId);
    setTenantId(data.tenantId);
  };

  const register = async (email: string, password: string, tenantName: string): Promise<void> => {
    const data = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, tenantName }),
    });
    setTokens(data.accessToken, data.refreshToken);
    setUserId(data.userId);
    setTenantId(data.tenantId);
  };

  const logout = (): void => {
    clearTokens();
    setUserId(null);
    setTenantId(null);
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: !!userId, userId, tenantId, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthState => useContext(AuthContext);
