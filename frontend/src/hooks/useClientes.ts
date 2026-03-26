import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { cleanCNPJ } from '@/lib/cnpj';
import { apiFetch } from '@/lib/api';

export interface ClientePJ {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  regime_tributario: 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | null;
  anexo_simples: 'I' | 'II' | 'III' | 'IV' | 'V' | null;
  cnae_principal: string | null;
  cnae_secundario: string | null;
  email: string | null;
  telefone: string | null;
  endereco: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  } | null;
  grupo_economico_id: string | null;
  tipo_estabelecimento: 'MATRIZ' | 'FILIAL';
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  corp_group?: string | null;
  aliquota_sobre_folha?: string | null;
  aliquota_sobre_faturamento?: string | null;
  is_service_provider?: boolean | null;
}

export type ClientePJInsert = Omit<ClientePJ, 'id' | 'created_at' | 'updated_at'>;
export type ClientePJUpdate = Partial<ClientePJInsert>;

function normalizeCliente(raw: any): ClientePJ {
  const normalizeBool = (value: any) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
      return Boolean(value);
    }
    if (typeof value === 'number') return value === 1;
    return Boolean(value);
  };

  const rawServiceFlag =
    raw.somente_prestador_servicos ??
    raw.somentePrestacaoServicos ??
    raw.fator_r ??
    raw.fatorR ??
    raw.fator_R ??
    null;

  return {
    id: String(raw.id ?? ''),
    cnpj: raw.cnpj || raw.cnpjMatriz || raw.cnpj_matriz || '',
    razao_social: raw.razao_social || raw.razaoSocial || '',
    nome_fantasia: raw.nome_fantasia ?? raw.nomeFantasia ?? null,
    regime_tributario: raw.regime_tributario ?? raw.regimeTributario ?? null,
    anexo_simples: raw.anexo_simples ?? null,
    cnae_principal: raw.cnae_principal ?? null,
    cnae_secundario: raw.cnae_secundario ?? raw.cnaeSecundario ?? raw.CNAE_secundario ?? null,
    email: raw.email ?? null,
    telefone: raw.telefone ?? null,
    endereco: raw.endereco ?? null,
    grupo_economico_id: raw.grupo_economico_id ?? raw.corp_group ?? null,
    tipo_estabelecimento: raw.tipo_estabelecimento || 'MATRIZ',
    ativo: raw.ativo !== undefined ? !!raw.ativo : true,
    created_by: raw.created_by ?? null,
    created_at: raw.created_at || raw.createdAt || new Date().toISOString(),
    updated_at: raw.updated_at || raw.updatedAt || raw.created_at || new Date().toISOString(),
    corp_group: raw.corp_group ?? null,
    aliquota_sobre_folha: raw.aliquota_sobre_folha ?? raw.aliquota_folha ?? null,
    aliquota_sobre_faturamento: raw.aliquota_sobre_faturamento ?? raw.aliquota_faturamento ?? null,
    is_service_provider: normalizeBool(rawServiceFlag),
  };
}

export function useClientes(searchTerm?: string) {
  return useQuery({
    queryKey: ['clientes', searchTerm],
    queryFn: async () => {
      const response = await apiFetch<any[]>('/clients', { method: 'GET' });
      // API returns array directly or { clients: [] }
      const clientesData = Array.isArray(response) ? response : (response?.clients || []);
      const clientes = clientesData.map(normalizeCliente);

      if (searchTerm && searchTerm.trim()) {
        const term = searchTerm.trim();
        const cleanedCnpj = cleanCNPJ(term);

        if (/^\d+$/.test(cleanedCnpj) && cleanedCnpj.length >= 3) {
          return clientes.filter(c => cleanCNPJ(c.cnpj).includes(cleanedCnpj));
        }

        const termLower = term.toLowerCase();
        return clientes.filter(c =>
          c.razao_social.toLowerCase().includes(termLower) ||
          (c.nome_fantasia || '').toLowerCase().includes(termLower)
        );
      }

      return clientes;
    },
  });
}

export function useCliente(id: string | undefined) {
  return useQuery({
    queryKey: ['cliente', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await apiFetch<{ client: any }>(`/clients/${id}`, { method: 'GET' });
      return response.client ? normalizeCliente(response.client) : null;
    },
    enabled: !!id,
  });
}

export function useGrupoEconomico(matrizId: string | undefined) {
  return useQuery({
    queryKey: ['grupo-economico', matrizId],
    queryFn: async () => {
      if (!matrizId) return [];
      const response = await apiFetch<any[]>('/clients', { method: 'GET' });
      // API returns array directly or { clients: [] }
      const clientesData = Array.isArray(response) ? response : (response?.clients || []);
      const clientes = clientesData.map(normalizeCliente);
      const matriz = clientes.find(c => c.id === matrizId);
      if (!matriz) return [];
      const grupo = matriz.grupo_economico_id || matriz.corp_group || matriz.id;
      return clientes.filter(c => (c.grupo_economico_id || c.corp_group) === grupo && c.id !== matrizId);
    },
    enabled: !!matrizId,
  });
}

function mapClienteToPayload(cliente: ClientePJInsert) {
  return {
    razaoSocial: cliente.razao_social,
    nomeFantasia: cliente.nome_fantasia,
    cnpjMatriz: cliente.cnpj,
    regimeTributario: cliente.regime_tributario,
    corp_group: cliente.grupo_economico_id ?? cliente.corp_group ?? null,
    somentePrestacaoServicos: cliente.is_service_provider ?? null,
    fatorR: cliente.is_service_provider ?? null,
    aliquotaSobreFolha: cliente.aliquota_sobre_folha ?? null,
    aliquotaSobreFaturamento: cliente.aliquota_sobre_faturamento ?? null,
    cnaePrincipal: cliente.cnae_principal ?? null,
    cnaeSecundario: cliente.cnae_secundario ?? null,
    cnpjsFiliais: []
  };
}

function mapClienteUpdatePayload(data: ClientePJUpdate) {
  const payload: Record<string, unknown> = {};

  if (data.razao_social !== undefined) payload.razaoSocial = data.razao_social;
  if (data.nome_fantasia !== undefined) payload.nomeFantasia = data.nome_fantasia;
  if (data.cnpj !== undefined) payload.cnpjMatriz = data.cnpj;
  if (data.regime_tributario !== undefined) payload.regimeTributario = data.regime_tributario;
  if (data.grupo_economico_id !== undefined || data.corp_group !== undefined) {
    payload.corp_group = data.grupo_economico_id ?? data.corp_group ?? null;
  }
  if (data.is_service_provider !== undefined) {
    payload.somentePrestacaoServicos = data.is_service_provider;
    payload.fatorR = data.is_service_provider;
  }
  if (data.aliquota_sobre_folha !== undefined) payload.aliquotaSobreFolha = data.aliquota_sobre_folha;
  if (data.aliquota_sobre_faturamento !== undefined) payload.aliquotaSobreFaturamento = data.aliquota_sobre_faturamento;
  if (data.cnae_principal !== undefined) payload.cnaePrincipal = data.cnae_principal;
  if (data.cnae_secundario !== undefined) payload.cnaeSecundario = data.cnae_secundario;

  return payload;
}

export function useCreateCliente() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (cliente: ClientePJInsert) => {
      const payload = mapClienteToPayload(cliente);
      const response = await apiFetch<{ client: any }>('/clients', {
        method: 'POST',
        body: payload
      });
      return response.client ? normalizeCliente(response.client) : null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast({
        title: 'Cliente cadastrado',
        description: 'O cliente foi cadastrado com sucesso.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao cadastrar',
        description: error.message.includes('duplicate key')
          ? 'Já existe um cliente com este CNPJ'
          : error.message,
      });
    },
  });
}

export function useUpdateCliente() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ClientePJUpdate }) => {
      const payload = mapClienteUpdatePayload(data);
      const response = await apiFetch<{ client: any }>(`/clients/${id}`, {
        method: 'PUT',
        body: payload
      });
      return response.client ? normalizeCliente(response.client) : null;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['cliente', variables.id] });
      toast({
        title: 'Cliente atualizado',
        description: 'As informações foram atualizadas com sucesso.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar',
        description: error.message,
      });
    },
  });
}

export function useDeleteCliente() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/clients/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast({
        title: 'Cliente excluído',
        description: 'O cliente foi excluído com sucesso.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir',
        description: error.message,
      });
    },
  });
}
