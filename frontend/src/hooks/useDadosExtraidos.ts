import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type TipoDocumento = 
  | 'nfe' 
  | 'nfse' 
  | 'cte' 
  | 'pgdas' 
  | 'guia_federal' 
  | 'guia_estadual' 
  | 'guia_municipal' 
  | 'extrato_bancario' 
  | 'folha_pagamento' 
  | 'contrato' 
  | 'outros';

export interface DadosExtraidos {
  id: string;
  documento_id: string;
  cliente_id: string;
  tipo_documento: TipoDocumento;
  competencia: string | null;
  valor_total: number | null;
  dados_nfe: Record<string, unknown>;
  dados_nfse: Record<string, unknown>;
  dados_pgdas: Record<string, unknown>;
  dados_guia: Record<string, unknown>;
  dados_extrato: Record<string, unknown>;
  dados_folha: Record<string, unknown>;
  confianca: number;
  extraido_em: string;
  modelo_ia: string | null;
  tokens_usados: number;
  created_at: string;
  updated_at: string;
  // Novas colunas para alinhamento n8n
  historico_receitas: Array<{ mes: string; valor: number }>;
  historico_folhas: Array<{ mes: string; valor: number }>;
  historico_impostos: Array<{ mes: string; valor: number }>;
  estabelecimentos: Array<{ tipo: string; cnpj: string; receita: number; aliquota: number; imposto: number }>;
  impostos_retidos: Record<string, unknown>;
  compras_mes: Record<string, unknown>;
  vendas_cartao: Record<string, unknown>;
  pix_recebidos: Record<string, unknown>;
  transferencias: Record<string, unknown>;
  fator_r_aplicado: number | null;
  anexo_detectado: string | null;
}

export interface DadosExtraidosWithDocumento extends DadosExtraidos {
  documentos: {
    nome_original: string;
    periodo: string | null;
  };
  clientes_pj: {
    razao_social: string;
    cnpj: string;
  };
}

export function useDadosExtraidos(clienteId?: string, competencia?: string) {
  return useQuery({
    queryKey: ['dados-extraidos', clienteId, competencia],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (clienteId) params.set('cliente_id', clienteId);
      if (competencia) params.set('competencia', competencia);
      const response = await apiFetch<{ dados: DadosExtraidosWithDocumento[] }>(
        `/dados-extraidos?${params.toString()}`,
        { method: 'GET' }
      );
      return response.dados || [];
    },
  });
}

export function useDadosExtraidosByDocumento(documentoId: string | undefined) {
  return useQuery({
    queryKey: ['dados-extraidos-documento', documentoId],
    queryFn: async () => {
      if (!documentoId) return null;
      const response = await apiFetch<{ dados: DadosExtraidos[] }>(
        `/dados-extraidos?documento_id=${encodeURIComponent(documentoId)}`,
        { method: 'GET' }
      );
      return response.dados?.[0] || null;
    },
    enabled: !!documentoId,
  });
}

export function useDadosExtraidosByTipo(clienteId: string, tipo: TipoDocumento, competencia?: string) {
  return useQuery({
    queryKey: ['dados-extraidos-tipo', clienteId, tipo, competencia],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('cliente_id', clienteId);
      params.set('tipo_documento', tipo);
      if (competencia) params.set('competencia', competencia);
      const response = await apiFetch<{ dados: DadosExtraidosWithDocumento[] }>(
        `/dados-extraidos?${params.toString()}`,
        { method: 'GET' }
      );
      return response.dados || [];
    },
  });
}

// Funções auxiliares para formatar dados
export function formatTipoDocumento(tipo: TipoDocumento): string {
  const labels: Record<TipoDocumento, string> = {
    nfe: 'NF-e',
    nfse: 'NFS-e',
    cte: 'CT-e',
    pgdas: 'PGDAS-D',
    guia_federal: 'Guia Federal',
    guia_estadual: 'Guia Estadual',
    guia_municipal: 'Guia Municipal',
    extrato_bancario: 'Extrato Bancário',
    folha_pagamento: 'Folha de Pagamento',
    contrato: 'Contrato',
    outros: 'Outros',
  };
  return labels[tipo] || tipo;
}

export function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
