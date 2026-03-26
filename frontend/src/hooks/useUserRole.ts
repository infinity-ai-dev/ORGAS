import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type AppRole = 'analista' | 'revisor' | 'admin';

interface UserRoleState {
  roles: AppRole[];
  isAnalista: boolean;
  isRevisor: boolean;
  isAdmin: boolean;
  loading: boolean;
}

export function useUserRole(): UserRoleState {
  const { user, loading } = useAuth();

  const roles = useMemo<AppRole[]>(() => {
    const role = (user?.role || user?.cargo || '').toLowerCase();
    const normalizedRole =
      role === 'desenvolvedor' || role === 'developer' || role === 'dev'
        ? 'analista'
        : role === 'administrador' || role === 'administrator'
          ? 'admin'
          : role;
    if (normalizedRole === 'analista' || normalizedRole === 'revisor' || normalizedRole === 'admin') {
      return [normalizedRole as AppRole];
    }
    return [];
  }, [user]);

  return {
    roles,
    isAnalista: roles.includes('analista'),
    isRevisor: roles.includes('revisor'),
    isAdmin: roles.includes('admin'),
    loading
  };
}
