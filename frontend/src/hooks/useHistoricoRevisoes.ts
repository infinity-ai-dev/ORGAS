import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type AcaoRevisao =
  | 'criado'
  | 'enviado_aprovacao'
  | 'aprovado'
  | 'rejeitado'
  | 'reaberto'
  | 'comentario_atualizado';

export interface HistoricoRevisao {
  id: string;
  relatorio_id: string;
  usuario_id: string;
  acao: AcaoRevisao;
  status_anterior: string | null;
  status_novo: string;
  comentario: string | null;
  created_at: string;
  profiles?: {
    full_name: string;
    avatar_url: string | null;
  };
}

export function useHistoricoRevisoes(relatorioId: string | undefined) {
  return useQuery({
    queryKey: ['historico-revisoes', relatorioId],
    queryFn: async () => {
      if (!relatorioId) return [];

      try {
        const response = await apiFetch<{ historico: any[] }>(`/relatorios/${relatorioId}/historico`, { method: 'GET' });
        const historico = response.historico || [];
        if (!historico.length) return [];

        return historico.map((h: any) => ({
          id: String(h.id),
          relatorio_id: String(h.relatorio_id || relatorioId),
          usuario_id: String(h.usuario_id || ''),
          acao: h.acao as AcaoRevisao,
          status_anterior: h.status_anterior || null,
          status_novo: h.status_novo || '',
          comentario: h.comentario || null,
          created_at: h.created_at || '',
          profiles: (h.usuario_nome || h.usuario_email || h.usuario_id)
            ? { full_name: h.usuario_nome || h.usuario_email || String(h.usuario_id || ''), avatar_url: null }
            : null
        })) as HistoricoRevisao[];
      } catch (error) {
        // Endpoint não existe ou erro na requisição - retorna array vazio
        console.debug('Histórico não disponível para este relatório');
        return [];
      }
    },
    enabled: !!relatorioId,
  });
}

export function useRegistrarRevisao() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      relatorioId,
      usuarioId,
      acao,
      statusAnterior,
      statusNovo,
      comentario,
    }: {
      relatorioId: string;
      usuarioId: string;
      acao: AcaoRevisao;
      statusAnterior?: string;
      statusNovo: string;
      comentario?: string;
    }) => {
      const response = await apiFetch<{ historico: any }>(`/relatorios/${relatorioId}/historico`, {
        method: 'POST',
        body: {
          usuario_id: usuarioId,
          acao,
          status_anterior: statusAnterior || null,
          status_novo: statusNovo,
          comentario: comentario || null,
        }
      });
      return response.historico;
    },
    onSuccess: (data) => {
      if (data?.relatorio_id) {
        queryClient.invalidateQueries({ queryKey: ['historico-revisoes', String(data.relatorio_id)] });
      }
    },
  });
}

export const acaoLabels: Record<AcaoRevisao, string> = {
  criado: 'Relatório Criado',
  enviado_aprovacao: 'Enviado para Aprovação',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  reaberto: 'Reaberto para Revisão',
  comentario_atualizado: 'Comentário atualizado',
};

export const acaoColors: Record<AcaoRevisao, string> = {
  criado: 'bg-blue-500',
  enviado_aprovacao: 'bg-yellow-500',
  aprovado: 'bg-green-500',
  rejeitado: 'bg-red-500',
  reaberto: 'bg-orange-500',
  comentario_atualizado: 'bg-slate-500',
};
