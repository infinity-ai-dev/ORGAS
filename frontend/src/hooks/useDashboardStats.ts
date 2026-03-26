import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

interface DashboardStats {
  documentosProcessados: number;
  pareceresGerados: number;
  pendentesAprovacao: number;
  alertasAtivos: number;
}

interface RelatorioRecente {
  id: string;
  competencia: string;
  status: string;
  cliente_nome: string;
  gerado_em: string;
}

interface AtividadeRecente {
  id: string;
  acao: string;
  created_at: string;
  usuario_nome: string;
  relatorio_competencia: string;
}

export function useDashboardStats() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const startOfMonth = new Date(currentYear, currentMonth - 1, 1).toISOString();

  return useQuery({
    queryKey: ['dashboard-stats', currentYear, currentMonth],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await apiFetch<DashboardStats>(`/dashboard/stats?from=${encodeURIComponent(startOfMonth)}`, {
        method: 'GET'
      });

      return {
        documentosProcessados: response.documentosProcessados || 0,
        pareceresGerados: response.pareceresGerados || 0,
        pendentesAprovacao: response.pendentesAprovacao || 0,
        alertasAtivos: response.alertasAtivos || 0
      };
    }
  });
}

export function useUltimosRelatorios(limit = 5) {
  return useQuery({
    queryKey: ['ultimos-relatorios', limit],
    queryFn: async (): Promise<RelatorioRecente[]> => {
      const data = await apiFetch<any[]>(`/relatorios`, { method: 'GET' });
      const rows = Array.isArray(data) ? data : [];
      const sorted = rows
        .slice()
        .sort((a, b) => {
          const aTime = new Date(a.date_time || a.created_at || 0).getTime();
          const bTime = new Date(b.date_time || b.created_at || 0).getTime();
          return bTime - aTime;
        })
        .slice(0, limit);

      return sorted.map(r => {
        let secoesJson = r.secoes_json;
        if (typeof secoesJson === 'string') {
          try {
            secoesJson = JSON.parse(secoesJson);
          } catch {
            secoesJson = {};
          }
        }
        const cabecalho = secoesJson?.dadosCabecalho || {};
        return {
          id: String(r.id),
          competencia: r.competencia || cabecalho.periodo || '',
          status: secoesJson?.status_relatorio || 'rascunho',
          cliente_nome:
            cabecalho.cliente_nome ||
            cabecalho.razaoSocial ||
            cabecalho.razao_social ||
            r.user_name ||
            'Cliente desconhecido',
          gerado_em: r.date_time || r.created_at || ''
        } as RelatorioRecente;
      });
    }
  });
}

export function useAtividadeRecente(limit = 5) {
  return useQuery({
    queryKey: ['atividade-recente', limit],
    queryFn: async (): Promise<AtividadeRecente[]> => {
      const response = await apiFetch<{ atividades: AtividadeRecente[] }>(`/atividades?limit=${limit}`, {
        method: 'GET'
      });
      return response.atividades || [];
    }
  });
}
