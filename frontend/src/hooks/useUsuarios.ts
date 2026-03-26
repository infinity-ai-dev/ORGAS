import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { AppRole } from './useUserRole';

export interface UserWithRoles {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
  roles: AppRole[];
}

type CreateUserInput = {
  nome: string;
  email: string;
  role: AppRole;
  password?: string;
  sendMagicLink?: boolean;
  sendResetLink?: boolean;
};

export function useUsuarios() {
  return useQuery({
    queryKey: ['usuarios'],
    queryFn: async (): Promise<UserWithRoles[]> => {
      const response = await apiFetch<{ users: any[] }>('/usuarios', { method: 'GET' });
      const users = response.users || [];
      return users.map(user => {
        const role = String(user.role || '').toLowerCase();
        const roles: AppRole[] = role === 'analista' || role === 'revisor' || role === 'admin' ? [role as AppRole] : [];
        return {
          id: String(user.id),
          email: user.email || '',
          full_name: user.nome || user.full_name || '',
          avatar_url: user.avatar_url || null,
          created_at: user.created_at || '',
          roles
        };
      });
    }
  });
}

export function useCreateUsuario() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: CreateUserInput) => {
      return apiFetch('/usuarios', {
        method: 'POST',
        body: payload
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      const deliveryMessage = data?.invitation?.actionUrl
        ? ' Convite enviado por e-mail.'
        : '';
      toast({ title: 'Usuário criado com sucesso', description: `Novo usuário cadastrado.${deliveryMessage}` });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao criar usuário',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

export function useAddRole() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await apiFetch(`/usuarios/${userId}/role`, {
        method: 'PUT',
        body: { role }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast({ title: 'Role adicionada com sucesso' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao adicionar role',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

export function useRemoveRole() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await apiFetch(`/usuarios/${userId}/role`, {
        method: 'PUT',
        body: { role: 'user' }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast({ title: 'Role removida com sucesso' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao remover role',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

export function useSendMagicLink() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      return apiFetch(`/usuarios/${userId}/send-magic-link`, {
        method: 'POST'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast({ title: 'Magic link enviado com sucesso' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao enviar magic link',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

export function useSendResetLink() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      return apiFetch(`/usuarios/${userId}/send-reset-link`, {
        method: 'POST'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast({ title: 'Link de redefinição enviado com sucesso' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao enviar link de redefinição',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

export function useSetUsuarioPassword() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      return apiFetch(`/usuarios/${userId}/set-password`, {
        method: 'POST',
        body: { newPassword }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast({ title: 'Senha do usuário atualizada com sucesso' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao atualizar senha',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}
