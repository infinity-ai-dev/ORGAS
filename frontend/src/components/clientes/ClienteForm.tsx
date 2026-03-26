import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { ClientePJ, ClientePJInsert, useClientes } from '@/hooks/useClientes';
import { maskCNPJ, maskPhone, cleanCNPJ, isValidCNPJ } from '@/lib/cnpj';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';

const clienteSchema = z
  .object({
    cnpj: z.string().min(14, 'CNPJ inválido').refine(val => isValidCNPJ(val), 'CNPJ inválido'),
    razao_social: z.string().min(3, 'Razão social deve ter pelo menos 3 caracteres').max(255),
    nome_fantasia: z.string().max(255).optional().nullable(),
    regime_tributario: z.enum(['simples_nacional', 'lucro_presumido', 'lucro_real']).optional().nullable(),
    anexo_simples: z.enum(['I', 'II', 'III', 'IV', 'V']).optional().nullable(),
    cnae_principal: z.string().max(20).optional().nullable(),
    cnae_secundario: z.string().max(255).optional().nullable(),
    email: z.string().email('E-mail inválido').max(255).optional().nullable().or(z.literal('')),
    telefone: z.string().max(20).optional().nullable(),
    tipo_estabelecimento: z.enum(['MATRIZ', 'FILIAL']),
    grupo_economico_id: z.string().uuid().optional().nullable(),
    is_service_provider: z.boolean().optional().default(false),
    aliquota_sobre_folha: z.string().max(10).optional().nullable(),
    aliquota_sobre_faturamento: z.string().max(10).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.is_service_provider) {
      if (!data.aliquota_sobre_folha || !data.aliquota_sobre_folha.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe a alíquota sobre folha',
          path: ['aliquota_sobre_folha'],
        });
      }
      if (!data.aliquota_sobre_faturamento || !data.aliquota_sobre_faturamento.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe a alíquota sobre faturamento',
          path: ['aliquota_sobre_faturamento'],
        });
      }
    }
  });

type ClienteFormData = z.infer<typeof clienteSchema>;

interface ClienteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cliente?: ClientePJ | null;
  onSubmit: (data: ClientePJInsert) => Promise<void>;
  isLoading?: boolean;
}

export function ClienteForm({ open, onOpenChange, cliente, onSubmit, isLoading }: ClienteFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: clientes } = useClientes();
  const [cnpjValue, setCnpjValue] = useState('');
  const [telefoneValue, setTelefoneValue] = useState('');
  const [isFetchingCnpj, setIsFetchingCnpj] = useState(false);
  const [lastFetchedCnpj, setLastFetchedCnpj] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      tipo_estabelecimento: 'MATRIZ',
      is_service_provider: false,
    },
  });

  const regimeTributario = watch('regime_tributario');
  const tipoEstabelecimento = watch('tipo_estabelecimento');
  const isServiceProvider = watch('is_service_provider');
  const aliquotaSobreFolha = watch('aliquota_sobre_folha');

  const parsePercentInput = (value: string | null | undefined) => {
    if (!value) return null;
    const normalized = value.replace(/[^\d,.-]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const aliquotaEfetiva = parsePercentInput(aliquotaSobreFolha);

  useEffect(() => {
    if (cliente) {
      setCnpjValue(maskCNPJ(cliente.cnpj));
      setTelefoneValue(cliente.telefone ? maskPhone(cliente.telefone) : '');
      setLastFetchedCnpj(cliente.cnpj);
      reset({
        cnpj: cliente.cnpj,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        regime_tributario: cliente.regime_tributario,
        anexo_simples: cliente.anexo_simples,
        cnae_principal: cliente.cnae_principal,
        cnae_secundario: cliente.cnae_secundario,
        email: cliente.email,
        telefone: cliente.telefone,
        tipo_estabelecimento: cliente.tipo_estabelecimento,
        grupo_economico_id: cliente.grupo_economico_id,
        is_service_provider: cliente.is_service_provider ?? false,
        aliquota_sobre_folha: cliente.aliquota_sobre_folha ?? null,
        aliquota_sobre_faturamento: cliente.aliquota_sobre_faturamento ?? null,
      });
    } else {
      setCnpjValue('');
      setTelefoneValue('');
      setLastFetchedCnpj(null);
      reset({
        tipo_estabelecimento: 'MATRIZ',
        is_service_provider: false,
      });
    }
  }, [cliente, reset]);

  useEffect(() => {
    if (!isServiceProvider) {
      setValue('aliquota_sobre_folha', null);
      setValue('aliquota_sobre_faturamento', null);
    }
  }, [isServiceProvider, setValue]);

  useEffect(() => {
    if (aliquotaEfetiva !== null && aliquotaEfetiva > 28) {
      if (regimeTributario !== 'simples_nacional') {
        setValue('regime_tributario', 'simples_nacional');
      }
      if (!isServiceProvider) {
        setValue('is_service_provider', true);
      }
    }
  }, [aliquotaEfetiva, regimeTributario, isServiceProvider, setValue]);

  useEffect(() => {
    if (regimeTributario !== 'simples_nacional' && isServiceProvider) {
      setValue('is_service_provider', false);
    }
  }, [regimeTributario, isServiceProvider, setValue]);

  const handleFormSubmit = async (data: ClienteFormData) => {
    const cleanedData: ClientePJInsert = {
      cnpj: cleanCNPJ(data.cnpj),
      razao_social: data.razao_social.trim(),
      nome_fantasia: data.nome_fantasia?.trim() || null,
      regime_tributario: data.regime_tributario || null,
      anexo_simples: data.regime_tributario === 'simples_nacional' ? data.anexo_simples : null,
      cnae_principal: data.cnae_principal?.trim() || null,
      cnae_secundario: data.cnae_secundario?.trim() || null,
      email: data.email?.trim() || null,
      telefone: data.telefone ? cleanCNPJ(data.telefone) : null,
      endereco: null,
      tipo_estabelecimento: data.tipo_estabelecimento,
      grupo_economico_id: data.tipo_estabelecimento === 'FILIAL' ? data.grupo_economico_id : null,
      ativo: true,
      created_by: user?.id || null,
      is_service_provider: data.is_service_provider ?? false,
      aliquota_sobre_folha: data.is_service_provider ? data.aliquota_sobre_folha?.trim() || null : null,
      aliquota_sobre_faturamento: data.is_service_provider ? data.aliquota_sobre_faturamento?.trim() || null : null,
    };

    await onSubmit(cleanedData);
    onOpenChange(false);
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskCNPJ(e.target.value);
    setCnpjValue(masked);
    setValue('cnpj', cleanCNPJ(masked), { shouldValidate: true });
  };

  const handleCnpjBlur = async () => {
    const cleaned = cleanCNPJ(cnpjValue);
    if (!cleaned || cleaned.length !== 14 || !isValidCNPJ(cleaned)) return;
    if (cleaned === lastFetchedCnpj) return;

    setIsFetchingCnpj(true);
    try {
      const data = await apiFetch<{
        razaoSocial?: string;
        nomeFantasia?: string;
        cnaePrincipal?: string;
        cnaePrincipalDescricao?: string;
        cnaesSecundarios?: Array<{ codigo: string; descricao: string }>;
        simplesNacional?: boolean;
        porte?: string;
        situacao?: string;
        logradouro?: string;
        numero?: string;
        bairro?: string;
        municipio?: string;
        uf?: string;
        cep?: string;
        email?: string;
        telefone?: string;
      }>('/cnpj', {
        method: 'POST',
        body: { cnpj: cleaned },
      });
      setLastFetchedCnpj(cleaned);

      if (data?.razaoSocial) {
        setValue('razao_social', data.razaoSocial);
      }
      if (data?.nomeFantasia) {
        setValue('nome_fantasia', data.nomeFantasia);
      }
      if (data?.cnaePrincipal) {
        setValue('cnae_principal', data.cnaePrincipal);
      }
      if (data?.cnaesSecundarios?.length) {
        const secundarias = data.cnaesSecundarios
          .map((item) => item.codigo)
          .filter(Boolean)
          .join(', ');
        if (secundarias) {
          setValue('cnae_secundario', secundarias);
        }
      }
      if (data?.simplesNacional) {
        setValue('regime_tributario', 'simples_nacional');
      }
      if (data?.email) {
        setValue('email', data.email);
      }

      if (data?.telefone) {
        const maskedPhone = maskPhone(String(data.telefone));
        setTelefoneValue(maskedPhone);
        setValue('telefone', maskedPhone);
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Falha ao buscar CNPJ',
        description: 'Não foi possível consultar os dados na BrasilAPI.',
      });
    } finally {
      setIsFetchingCnpj(false);
    }
  };

  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskPhone(e.target.value);
    setTelefoneValue(masked);
    setValue('telefone', masked);
  };

  const matrizes = clientes?.filter(c => c.tipo_estabelecimento === 'MATRIZ' && c.id !== cliente?.id) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          <DialogDescription>
            {cliente ? 'Atualize as informações do cliente' : 'Preencha os dados para cadastrar um novo cliente PJ'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ *</Label>
              <Input
                id="cnpj"
                value={cnpjValue}
                onChange={handleCnpjChange}
                onBlur={handleCnpjBlur}
                placeholder="00.000.000/0000-00"
                disabled={isLoading}
              />
              {isFetchingCnpj && (
                <p className="text-xs text-muted-foreground">Consultando BrasilAPI...</p>
              )}
              {errors.cnpj && <p className="text-xs text-destructive">{errors.cnpj.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo_estabelecimento">Tipo *</Label>
              <Select
                value={tipoEstabelecimento}
                onValueChange={(value: 'MATRIZ' | 'FILIAL') => setValue('tipo_estabelecimento', value)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MATRIZ">Matriz</SelectItem>
                  <SelectItem value="FILIAL">Filial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {tipoEstabelecimento === 'FILIAL' && (
            <div className="space-y-2">
              <Label htmlFor="grupo_economico_id">Matriz (Grupo Econômico)</Label>
              <Select
                value={watch('grupo_economico_id') || ''}
                onValueChange={(value) => setValue('grupo_economico_id', value || null)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a matriz" />
                </SelectTrigger>
                <SelectContent>
                  {matrizes.map(matriz => (
                    <SelectItem key={matriz.id} value={matriz.id}>
                      {matriz.razao_social} ({maskCNPJ(matriz.cnpj)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="razao_social">Razão Social *</Label>
            <Input
              id="razao_social"
              {...register('razao_social')}
              placeholder="Razão social da empresa"
              disabled={isLoading}
            />
            {errors.razao_social && <p className="text-xs text-destructive">{errors.razao_social.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nome_fantasia">Nome Fantasia</Label>
            <Input
              id="nome_fantasia"
              {...register('nome_fantasia')}
              placeholder="Nome fantasia (opcional)"
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="regime_tributario">Regime Tributário</Label>
              <Select
                value={regimeTributario || ''}
                onValueChange={(value: 'simples_nacional' | 'lucro_presumido' | 'lucro_real') => 
                  setValue('regime_tributario', value || null)
                }
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simples_nacional">Simples Nacional</SelectItem>
                  <SelectItem value="lucro_presumido">Lucro Presumido</SelectItem>
                  <SelectItem value="lucro_real">Lucro Real</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {regimeTributario === 'simples_nacional' && (
              <div className="space-y-2">
                <Label htmlFor="anexo_simples">Anexo do Simples</Label>
                <Select
                  value={watch('anexo_simples') || ''}
                  onValueChange={(value: 'I' | 'II' | 'III' | 'IV' | 'V') => 
                    setValue('anexo_simples', value || null)
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I">Anexo I - Comércio</SelectItem>
                    <SelectItem value="II">Anexo II - Indústria</SelectItem>
                    <SelectItem value="III">Anexo III - Serviços</SelectItem>
                    <SelectItem value="IV">Anexo IV - Serviços</SelectItem>
                    <SelectItem value="V">Anexo V - Serviços</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_service_provider"
                checked={isServiceProvider}
                onCheckedChange={(checked) => {
                  const nextValue = Boolean(checked);
                  if (nextValue && regimeTributario !== 'simples_nacional') {
                    setValue('regime_tributario', 'simples_nacional');
                  }
                  setValue('is_service_provider', nextValue);
                }}
                disabled={isLoading}
              />
              <Label htmlFor="is_service_provider">Somente prestação de serviços (Fator R)</Label>
            </div>
            {regimeTributario !== 'simples_nacional' && (
              <p className="text-xs text-muted-foreground">
                Disponível apenas para Simples Nacional.
              </p>
            )}

            {isServiceProvider && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="aliquota_sobre_folha">Alíquota sobre folha (%)</Label>
                  <Input
                    id="aliquota_sobre_folha"
                    {...register('aliquota_sobre_folha')}
                    placeholder="ex: 28,00"
                    disabled={isLoading}
                  />
                  {errors.aliquota_sobre_folha && (
                    <p className="text-xs text-destructive">{errors.aliquota_sobre_folha.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aliquota_sobre_faturamento">Alíquota sobre faturamento (%)</Label>
                  <Input
                    id="aliquota_sobre_faturamento"
                    {...register('aliquota_sobre_faturamento')}
                    placeholder="ex: 6,00"
                    disabled={isLoading}
                  />
                  {errors.aliquota_sobre_faturamento && (
                    <p className="text-xs text-destructive">{errors.aliquota_sobre_faturamento.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cnae_principal">CNAE Principal</Label>
            <Input
              id="cnae_principal"
              {...register('cnae_principal')}
              placeholder="0000-0/00"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cnae_secundario">CNAE Secundário</Label>
            <Input
              id="cnae_secundario"
              {...register('cnae_secundario')}
              placeholder="0000-0/00, 0000-0/00"
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                {...register('email')}
                placeholder="contato@empresa.com"
                disabled={isLoading}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                value={telefoneValue}
                onChange={handleTelefoneChange}
                placeholder="(00) 00000-0000"
                disabled={isLoading}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cliente ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
