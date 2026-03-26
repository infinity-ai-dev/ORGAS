import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';

/**
 * Tipos genéricos para dados do agente
 */
export interface RelatorioEmAprovacao {
  id: string;
  request_id: string | null;
  cliente_id: string;
  cliente_nome: string;
  tipo_parecer:
    | 'fiscal'
    | 'pessoal'
    | 'personal'
    | 'contabil'
    | 'accounting'
    | 'atendimento'
    | 'support'
    | 'generico'
    | string;
  tipo_parecer_label?: string;
  frontend_variant?: string;
  response_data: AgentResponse;
  documentos_analisados?: number;
  etapas_executadas?: number;
  status_aprovacao: 'pendente' | 'aprovado' | 'reprovado';
  data_geracao?: string;
  vencimento_em?: string;
  criado_em?: string;
}

/**
 * Estrutura genérica de resposta do agente
 */
export interface AgentResponse {
  step: string;
  agent: string;
  status: 'complete' | 'error' | 'pending';
  is_valid: boolean;
  [key: string]: any; // Dados específicos do tipo de parecer
}

/**
 * Parecer Fiscal específico - Structured Output Format
 */
export interface PareceiFiscalResponse extends AgentResponse {
  agent: 'fiscal';
  competencia?: string | null;
  periodo?: string | null;
  imposto_devido?: number | string;
  imposto_pago?: number | string;
  diferenca?: number | string;
  regime_tributario?: string;
  receita_bruta?: {
    valor: number;
    formatado: string;
    periodo?: string;
  };
  fiscal_data?: {
    regime_tributario?: string | null;
    competencia?: string | null;
    periodo?: string | null;
    receita_bruta?: { valor?: number; formatado?: string; periodo?: string };
    receita_bruta_mes?: number | string;
    receita_bruta_2024?: number | string;
    simples_valor_devido?: number | string;
    imposto_devido?: number | string;
    imposto_devido_2024?: number | string;
    imposto_pago?: number | string;
    imposto_pago_2024?: number | string;
    diferenca?: number | string;
    obrigacoes_acessorias?: string[];
    [key: string]: any;
  };
  despesas?: {
    total: number;
    deducoes?: number;
    formatado?: string;
  };
  impostos?: {
    devido: number;
    pago: number;
    diferenca: number;
    aliquota_efetiva?: number;
  };
  obrigacoes_acessorias?: string[];
  dados_estabelecimentos?: Array<{
    descricao: string;
    cnpj: string;
    receita: number;
    aliquota: number;
    imposto: number;
  }>;
  alertas?: Array<{
    tipo: string;
    nivel: string;
    mensagem: string;
  }>;
  recommendations?: string[];
  risks_identified?: string[];
  validation_errors?: string[];
  validacao_erros?: string[];
  data_sources?: string[];
}

/**
 * Hook para buscar relatórios em aprovação
 */
export function useRelatoriosEmAprovacao(tipoParecerFilter?: string) {
  return useQuery({
    queryKey: ['relatorios-em-aprovacao', tipoParecerFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tipoParecerFilter) {
        params.append('tipo_parecer', tipoParecerFilter);
      }

      const response = await apiFetch<{ success: boolean; count: number; data: RelatorioEmAprovacao[] }>(
        `/relatorios/approval/pendentes?${params.toString()}`,
        { method: 'GET' }
      );

      return (response.data || []) as RelatorioEmAprovacao[];
    },
  });
}

/**
 * Hook para obter detalhes de um relatório em aprovação
 */
export function useRelatorioEmAprovacaoDetalhes(id: string | undefined) {
  return useQuery({
    queryKey: ['relatorio-em-aprovacao', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await apiFetch<{ success: boolean; data: RelatorioEmAprovacao }>(
        `/relatorios/approval/${id}/detalhes`,
        { method: 'GET' }
      );
      return response.data;
    },
    enabled: !!id,
  });
}

/**
 * Hook para atualizar status de relatório em aprovação
 */
export function useAprovarRelatorioEmAprovacao() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      aprovadoPor,
      observacoes,
    }: {
      id: string;
      aprovadoPor: string;
      observacoes?: string;
    }) => {
      const response = await apiFetch<{ success: boolean; id: string }>(
        `/relatorios/approval/${id}/aprovar`,
        {
          method: 'POST',
          body: {
            aprovado_por: aprovadoPor,
            observacoes_aprovacao: observacoes,
          },
        }
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relatorios-em-aprovacao'] });
      toast({
        title: 'Relatório aprovado',
        description: 'O relatório foi movido para a lista de aprovados.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao aprovar',
        description: error.message,
      });
    },
  });
}

/**
 * Hook para rejeitar relatório em aprovação
 */
export function useReprovarRelatorioEmAprovacao() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      reprovadoPor,
      motivo_rejeicao,
      justificativa,
      campo_com_erro,
      valor_esperado,
      valor_recebido,
      secoes_com_erro,
    }: {
      id: string;
      reprovadoPor: string;
      motivo_rejeicao: string;
      justificativa: string;
      campo_com_erro?: string;
      valor_esperado?: string;
      valor_recebido?: string;
      secoes_com_erro?: string[];
    }) => {
      const response = await apiFetch<{ success: boolean; id: string }>(
        `/relatorios/approval/${id}/reprovar`,
        {
          method: 'POST',
          body: {
            reprovado_por: reprovadoPor,
            motivo_rejeicao,
            justificativa,
            campo_com_erro,
            valor_esperado,
            valor_recebido,
            secoes_com_erro,
          },
        }
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relatorios-em-aprovacao'] });
      toast({
        title: 'Relatório rejeitado',
        description: 'O relatório foi movido para a lista de rejeitados.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao rejeitar',
        description: error.message,
      });
    },
  });
}

/**
 * Extrai dados comuns de qualquer tipo de parecer
 */
export function extractCommonData(response: AgentResponse) {
  return {
    status: response.status,
    is_valid: response.is_valid,
    validation_errors: (response as any).validation_errors || [],
    recommendations: (response as any).recommendations || [],
    risks_identified: (response as any).risks_identified || [],
  };
}

/**
 * Parecer Pessoal específico
 */
export interface ParecePersonalResponse extends AgentResponse {
  agent: 'personal';
  competencia?: string | null;
  cliente_cnpj?: string | null;
  documentos_analisados?: number;
  documentos_por_tipo?: Record<string, number>;
  documentos_sem_texto?: string[];
  missing_required_documents?: string[];
  alertas?: string[];
  recommendations?: string[];
  comentarios?: {
    agente?: string;
    analista?: string;
  };
  documentos_recebidos?: Array<{
    nome: string;
    tipo: string;
    mime_type?: string;
    texto_extraido?: boolean;
    erro_extracao?: string | null;
  }>;
  compliance?: {
    gdpr: boolean;
    lgpd: boolean;
    data_minimization: boolean;
    anonymization_level: string;
  };
  personal_summary?: string;
  masking_rules_applied?: string[];
  privacy_recommendations?: string[];
  personal_data_anonymized?: {
    cpf: string;
    email: string;
    user_id: string | null;
    endereco: string;
    telefone: string;
    profissao: string;
    dependentes: number;
    estado_civil: string;
    nome_completo: string;
    data_nascimento: string;
    renda_aproximada: string;
    [key: string]: any;
  };
}

/**
 * Tipo guarda para parecer fiscal
 */
export function isPareceiFiscal(response: AgentResponse): response is PareceiFiscalResponse {
  return (response as any).agent === 'fiscal';
}

/**
 * Tipo guarda para parecer pessoal
 */
export function isParecerPersonal(response: AgentResponse): response is ParecePersonalResponse {
  return (response as any).agent === 'personal';
}
