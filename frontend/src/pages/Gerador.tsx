import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { 
  Upload, 
  FileText, 
  Loader2, 
  X, 
  Check,
  ChevronsUpDown,
  Wand2,
  FileSpreadsheet,
  FileCode,
  File,
  Info,
} from 'lucide-react';
import { useClientes } from '@/hooks/useClientes';
import { useEnviarDocumentos, fileToBase64 } from '@/hooks/useDocumentos';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const TIPOS_RELATORIO = [
  { value: 'parecer', label: 'Parecer' },
  { value: 'contrato', label: 'Contrato' },
  { value: 'acordo', label: 'Acordo' },
  { value: 'interacao', label: 'Interação' },
];

const TIPOS_PARECER = [
  { value: 'fiscal', label: 'Fiscal' },
  { value: 'contabil', label: 'Contábil' },
  { value: 'pessoal', label: 'Pessoal' },
  { value: 'atendimento', label: 'Atendimento' },
];

const REGIMES_TRIBUTARIOS = [
  { value: 'simples_nacional', label: 'Simples Nacional' },
  { value: 'simples_fator_r', label: 'Simples Nacional Fator R' },
  { value: 'lucro_real', label: 'Lucro Real' },
  { value: 'lucro_presumido', label: 'Lucro Presumido' },
];

const MESES = [
  { value: 1, label: 'Janeiro' },
  { value: 2, label: 'Fevereiro' },
  { value: 3, label: 'Março' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Maio' },
  { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' },
  { value: 11, label: 'Novembro' },
  { value: 12, label: 'Dezembro' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const ANOS = Array.from({ length: 5 }, (_, i) => currentYear - i);

interface FileWithProgress {
  file: File;
  id: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  docType: string;
}

type DocumentoChecklist = {
  key: string;
  label: string;
  description: string;
  required: boolean;
};

const DOCUMENTOS_PARECER_FISCAL: DocumentoChecklist[] = [
  {
    key: 'pgdas',
    label: 'PGDAS / DAS',
    description: 'Guia e apuração do Simples Nacional da competência.',
    required: true,
  },
  {
    key: 'extratos',
    label: 'Extratos Bancários',
    description: 'Extratos de todas as contas movimentadas.',
    required: true,
  },
  {
    key: 'folha',
    label: 'Folha de Pagamento',
    description: 'Resumo da folha e encargos do mês.',
    required: true,
  },
  {
    key: 'notas',
    label: 'Notas / Documentos Fiscais',
    description: 'NF-e, NFS-e, NFC-e ou equivalentes.',
    required: true,
  },
  {
    key: 'outros',
    label: 'Outros Documentos',
    description: 'Anexos adicionais que ajudem na análise.',
    required: false,
  },
];

const DOCUMENTOS_PARECER_PESSOAL: DocumentoChecklist[] = [
  {
    key: 'folha_pagamento',
    label: 'Folha de Pagamento (Extrato Mensal)',
    description: 'Resumo mensal da folha, INSS, FGTS e líquido.',
    required: true,
  },
  {
    key: 'irrf',
    label: 'Encargos de IRRF',
    description: 'Relação das bases do IRRF / resumo geral.',
    required: true,
  },
  {
    key: 'ponto',
    label: 'Controle de Jornada (Ponto)',
    description: 'Cartão ponto, espelho ponto ou relatório de frequência.',
    required: true,
  },
  {
    key: 'eventos',
    label: 'Eventos do Mês (Férias/Rescisões/Admissões)',
    description: 'Listagens ou comunicados para eventos do DP.',
    required: false,
  },
  {
    key: 'consignado',
    label: 'Consignado FGTS Digital',
    description: 'Quadros de consignado/FGTS Digital (se houver).',
    required: false,
  },
  {
    key: 'outros',
    label: 'Outros Documentos',
    description: 'Anexos adicionais para o parecer pessoal.',
    required: false,
  },
];

const DOCUMENTOS_PARECER_GERAL: DocumentoChecklist[] = [
  {
    key: 'documentos',
    label: 'Documentos do Cliente',
    description: 'Arquivos necessários para o parecer.',
    required: true,
  },
  {
    key: 'outros',
    label: 'Outros Documentos',
    description: 'Anexos adicionais que ajudem na análise.',
    required: false,
  },
];

const ACCEPTED_EXTENSIONS = '.pdf,.xml,.txt,.xlsx,.xls,.jpg,.jpeg';

export default function Gerador() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [tipoRelatorio, setTipoRelatorio] = useState('parecer');
  const [tipoParecer, setTipoParecer] = useState('fiscal');
  const [regimeTributario, setRegimeTributario] = useState('simples_nacional');
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteSearch, setClienteSearch] = useState('');
  const [selectedMes, setSelectedMes] = useState(currentMonth);
  const [selectedAno, setSelectedAno] = useState(currentYear);
  const [infoAdicional, setInfoAdicional] = useState('');
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [missingReasons, setMissingReasons] = useState<Record<string, { acknowledged: boolean; reason: string }>>({});
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: clientes, isLoading: clientesLoading } = useClientes(clienteSearch);
  const enviarDocumentos = useEnviarDocumentos();
  const { user } = useAuth();

  const selectedCliente = clientes?.find(c => c.id === selectedClienteId);

  const checklist = useMemo<DocumentoChecklist[]>(() => {
    if (tipoRelatorio === 'parecer' && tipoParecer === 'fiscal') {
      return DOCUMENTOS_PARECER_FISCAL;
    }
    if (tipoRelatorio === 'parecer' && tipoParecer === 'pessoal') {
      return DOCUMENTOS_PARECER_PESSOAL;
    }
    if (tipoRelatorio === 'parecer') {
      return DOCUMENTOS_PARECER_GERAL;
    }
    return DOCUMENTOS_PARECER_GERAL;
  }, [tipoRelatorio, tipoParecer]);

  const handleFilesSelected = useCallback((docType: string, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const acceptedFiles = Array.from(fileList);
    const newFiles: FileWithProgress[] = acceptedFiles.map(file => ({
      file,
      id: `${docType}-${file.name}-${Date.now()}-${Math.random()}`,
      progress: 0,
      status: 'pending',
      docType,
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setMissingReasons(prev => {
      if (!prev[docType]) return prev;
      return { ...prev, [docType]: { acknowledged: false, reason: '' } };
    });
  }, []);

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return <FileText className="h-5 w-5 text-red-500" />;
      case 'xml':
        return <FileCode className="h-5 w-5 text-orange-500" />;
      case 'xlsx':
      case 'xls':
        return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
      default:
        return <File className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleGerarRelatorio = async () => {
    if (!selectedClienteId) {
      toast({
        variant: 'destructive',
        title: 'Cliente obrigatório',
        description: 'Selecione um cliente para gerar o relatório.',
      });
      return;
    }

    setIsGenerating(true);

    try {
      const filesByType = checklist.reduce<Record<string, FileWithProgress[]>>((acc, item) => {
        acc[item.key] = files.filter(f => f.docType === item.key);
        return acc;
      }, {});
      const missingRequired = checklist.filter(item => item.required && (filesByType[item.key]?.length ?? 0) === 0);
      const missingWithoutReason = missingRequired.filter(item => {
        const state = missingReasons[item.key];
        return !state?.acknowledged || !state?.reason?.trim();
      });

      if (files.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Nenhum documento',
          description: 'Adicione ao menos um arquivo para gerar o relatório.'
        });
        setIsGenerating(false);
        return;
      }
      if (missingWithoutReason.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Documentos obrigatórios pendentes',
          description: 'Explique o motivo de não enviar cada documento obrigatório ausente.'
        });
        setIsGenerating(false);
        return;
      }

      const documentosPayload = [];

      for (let i = 0; i < files.length; i++) {
        const fileItem = files[i];
        setFiles(prev => prev.map(f =>
          f.id === fileItem.id ? { ...f, status: 'uploading', progress: 50 } : f
        ));

        try {
          const base64 = await fileToBase64(fileItem.file);
          documentosPayload.push({
            name: fileItem.file.name,
            content: base64,
            mimeType: fileItem.file.type || 'application/pdf',
            size: fileItem.file.size,
            documentoTipo: fileItem.docType,
          });

          setFiles(prev => prev.map(f =>
            f.id === fileItem.id ? { ...f, status: 'success', progress: 100 } : f
          ));
        } catch (error) {
          setFiles(prev => prev.map(f =>
            f.id === fileItem.id ? {
              ...f,
              status: 'error',
              progress: 0,
              error: error instanceof Error ? error.message : 'Erro ao ler arquivo'
            } : f
          ));
        }
      }

      const competencia = `${String(selectedMes).padStart(2, '0')}/${selectedAno}`;
      const missingDocsPayload = missingRequired.map(item => ({
        key: item.key,
        tipo: item.label,
        motivo: missingReasons[item.key]?.reason || ''
      }));
      const observacoesPendencias = missingDocsPayload.length
        ? `\n\nDocumentos não enviados:\n${missingDocsPayload
            .map(doc => `- ${doc.tipo}: ${doc.motivo || 'Sem motivo informado'}`)
            .join('\n')}`
        : '';
      const observacoesFinal = `${infoAdicional || ''}${observacoesPendencias}`.trim();
      const isParecerPessoal = tipoRelatorio === 'parecer' && tipoParecer === 'pessoal';
      toast({
        title: 'Enviando documentos...',
        description: 'Processando com o agente interno.',
      });

      const result = await enviarDocumentos.mutateAsync({
        documents: documentosPayload,
        clientId: selectedClienteId,
        user_id: user?.id || undefined,
        user_name: user?.nome || undefined,
        user_email: user?.email || undefined,
        cliente_nome: selectedCliente?.razao_social,
        cliente_cnpj: selectedCliente?.cnpj,
        cliente_regime_tributario: isParecerPessoal ? undefined : selectedCliente?.regime_tributario || undefined,
        cliente_corp_group: selectedCliente?.corp_group || undefined,
        categoria: tipoRelatorio,
        competencia,
        relatorio_type: tipoRelatorio,
        tipo_parecer: tipoParecer,
        is_parecer: tipoRelatorio === 'parecer',
        fiscal_tributation: isParecerPessoal ? undefined : regimeTributario,
        observacoes: observacoesFinal,
        documentos_pendentes: missingDocsPayload,
        analista_nome: user?.nome,
        analista_email: user?.email,
        reportId: undefined
      });

      if (result?.reportId) {
        navigate(`/relatorios/${result.reportId}`);
      } else {
        navigate('/relatorios');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao gerar relatório',
        description: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const filesByType = useMemo(() => {
    return checklist.reduce<Record<string, FileWithProgress[]>>((acc, item) => {
      acc[item.key] = files.filter(f => f.docType === item.key);
      return acc;
    }, {});
  }, [files, checklist]);

  const missingRequired = checklist.filter(item => item.required && (filesByType[item.key]?.length ?? 0) === 0);
  const missingWithoutReason = missingRequired.filter(item => {
    const state = missingReasons[item.key];
    return !state?.acknowledged || !state?.reason?.trim();
  });
  const hasMissingRequired = missingRequired.length > 0;
  const canGenerate = selectedClienteId && !isGenerating && files.length > 0 && missingWithoutReason.length === 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gerador de Relatórios</h1>
          <p className="text-muted-foreground">
            Configure e gere relatórios fiscais a partir dos documentos do cliente.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Configuração */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Configuração
              </CardTitle>
              <CardDescription>
                Selecione o tipo de relatório, cliente e período
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tipo de Relatório */}
              <div className="space-y-2">
                <Label htmlFor="tipoRelatorio">Tipo de Relatório</Label>
                <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                  <SelectTrigger id="tipoRelatorio">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_RELATORIO.map(tipo => (
                      <SelectItem key={tipo.value} value={tipo.value}>
                        {tipo.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tipo de Parecer - só aparece quando tipoRelatorio === 'parecer' */}
              {tipoRelatorio === 'parecer' && (
                <div className="space-y-2">
                  <Label htmlFor="tipoParecer">Tipo de Parecer</Label>
                  <Select value={tipoParecer} onValueChange={setTipoParecer}>
                    <SelectTrigger id="tipoParecer">
                      <SelectValue placeholder="Selecione o tipo de parecer" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_PARECER.map((tipo) => (
                        <SelectItem key={tipo.value} value={tipo.value}>
                          {tipo.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Regime Tributário - só aparece quando tipoParecer === 'fiscal' */}
              {tipoRelatorio === 'parecer' && tipoParecer === 'fiscal' && (
                <div className="space-y-2">
                  <Label htmlFor="regimeTributario">Regime Tributário</Label>
                  <Select value={regimeTributario} onValueChange={setRegimeTributario}>
                    <SelectTrigger id="regimeTributario">
                      <SelectValue placeholder="Selecione o regime tributário" />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIMES_TRIBUTARIOS.map((regime) => (
                        <SelectItem key={regime.value} value={regime.value}>
                          {regime.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Cliente com Autocomplete */}
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Popover open={clienteOpen} onOpenChange={setClienteOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="selectedClient"
                      variant="outline"
                      role="combobox"
                      aria-expanded={clienteOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedCliente 
                        ? selectedCliente.razao_social 
                        : "Buscar cliente..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput 
                        placeholder="Buscar por nome ou CNPJ..." 
                        value={clienteSearch}
                        onValueChange={setClienteSearch}
                      />
                      <CommandList>
                        {clientesLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        ) : clientes?.length === 0 ? (
                          <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                        ) : (
                          <CommandGroup>
                            {clientes?.map(cliente => (
                              <CommandItem
                                key={cliente.id}
                                value={cliente.id}
                                onSelect={() => {
                                  setSelectedClienteId(cliente.id);
                                  setClienteOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedClienteId === cliente.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span>{cliente.razao_social}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {cliente.cnpj}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Competência */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select 
                    value={String(selectedMes)} 
                    onValueChange={(v) => setSelectedMes(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Mês" />
                    </SelectTrigger>
                    <SelectContent>
                      {MESES.map(m => (
                        <SelectItem key={m.value} value={String(m.value)}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Select 
                    value={String(selectedAno)} 
                    onValueChange={(v) => setSelectedAno(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Ano" />
                    </SelectTrigger>
                    <SelectContent>
                      {ANOS.map(a => (
                        <SelectItem key={a} value={String(a)}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Informações Adicionais */}
              <div className="space-y-2">
                <Label htmlFor="additionalInfo">Informações Adicionais</Label>
                <Textarea
                  id="additionalInfo"
                  placeholder="Observações ou informações relevantes para o relatório..."
                  value={infoAdicional}
                  onChange={(e) => setInfoAdicional(e.target.value)}
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Upload de Documentos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Documentos
              </CardTitle>
              <CardDescription>
                Selecione os documentos necessários para o tipo de relatório
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Instruções de Upload */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Instruções de Upload
                </h4>
                <ul className="text-sm space-y-1.5">
                  <li>
                    <span className="font-medium">Extensões aceitas:</span>{" "}
                    <span className="text-muted-foreground">.txt, .pdf, .xml, .xlsx, .xls</span>
                  </li>
                  <li className="text-amber-600 font-medium">
                    Importante: Por favor, envie apenas documentos, não arraste pastas
                  </li>
                  <li>
                    <span className="font-medium">Tamanho máx. do documento:</span>{" "}
                    <span className="text-muted-foreground">20MB</span>
                  </li>
                </ul>
              </div>

              {/* Checklist de documentos */}
              <div className="space-y-4">
                {checklist.map((doc) => {
                  const docFiles = filesByType[doc.key] || [];
                  const isMissing = doc.required && docFiles.length === 0;
                  const missingState = missingReasons[doc.key] || { acknowledged: false, reason: '' };
                  return (
                    <div
                      key={doc.key}
                      className={cn(
                        'rounded-lg border p-4 space-y-3',
                        isMissing && !missingState.acknowledged
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-border'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{doc.label}</p>
                            {doc.required && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                Obrigatório
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{doc.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button asChild size="sm" variant="outline">
                            <label htmlFor={`doc-${doc.key}`}>Adicionar arquivos</label>
                          </Button>
                          <Input
                            id={`doc-${doc.key}`}
                            type="file"
                            accept={ACCEPTED_EXTENSIONS}
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              handleFilesSelected(doc.key, event.target.files);
                              event.currentTarget.value = '';
                            }}
                          />
                        </div>
                      </div>

                      {docFiles.length > 0 && (
                        <div className="space-y-2">
                          {docFiles.map(fileItem => (
                            <div
                              key={fileItem.id}
                              className="flex items-center gap-3 rounded-lg border p-3"
                            >
                              {getFileIcon(fileItem.file.name)}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {fileItem.file.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(fileItem.file.size)}
                                </p>
                                {fileItem.status === 'uploading' && (
                                  <Progress value={fileItem.progress} className="h-1 mt-1" />
                                )}
                                {fileItem.status === 'error' && (
                                  <p className="text-xs text-destructive mt-1">{fileItem.error}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {fileItem.status === 'success' && (
                                  <Check className="h-4 w-4 text-green-500" />
                                )}
                                {fileItem.status === 'uploading' && (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                )}
                                {fileItem.status === 'pending' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeFile(fileItem.id)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {isMissing && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={missingState.acknowledged}
                              onCheckedChange={(checked) => {
                                const isChecked = checked === true;
                                setMissingReasons(prev => ({
                                  ...prev,
                                  [doc.key]: {
                                    acknowledged: isChecked,
                                    reason: isChecked ? prev[doc.key]?.reason || '' : ''
                                  }
                                }));
                              }}
                            />
                            <span className="text-sm text-muted-foreground">
                              Documento não enviado (informar motivo)
                            </span>
                          </div>
                          {missingState.acknowledged && (
                            <Textarea
                              placeholder="Explique o motivo da ausência deste documento..."
                              value={missingState.reason}
                              onChange={(event) =>
                                setMissingReasons(prev => ({
                                  ...prev,
                                  [doc.key]: { acknowledged: true, reason: event.target.value }
                                }))
                              }
                              rows={3}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {hasMissingRequired && (
                <div className="rounded-lg border border-amber-400/40 bg-amber-50/60 p-4 text-sm text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                  Existem documentos obrigatórios pendentes. Para enviar mesmo assim, marque o documento como não enviado
                  e informe o motivo.
                </div>
              )}

              {/* Steps do Processo */}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">1</span>
                  <div>
                    <p className="font-medium">Seleção de Documentos</p>
                    <p className="text-sm text-muted-foreground">
                      Selecione os documentos relevantes para o tipo de relatório escolhido
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">2</span>
                  <div>
                    <p className="font-medium">Processamento</p>
                    <p className="text-sm text-muted-foreground">
                      Os documentos são analisados e os dados são extraídos automaticamente
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">3</span>
                  <div>
                    <p className="font-medium">Geração do Relatório</p>
                    <p className="text-sm text-muted-foreground">
                      O relatório é gerado e enviado para análise de qualidade
                    </p>
                  </div>
                </div>
              </div>

              {/* Tempo Estimado */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-medium mb-2">Tempo Estimado</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Pareceres: 2-3 minutos</li>
                  <li>• Contratos: 3-5 minutos</li>
                  <li>• Acordos: 2-3 minutos</li>
                  <li>• Interações: 1-2 minutos</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Botão Gerar */}
        <div className="flex flex-col items-end gap-2">
          <Button
            size="lg"
            onClick={handleGerarRelatorio}
            disabled={!canGenerate}
            className="min-w-[200px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                {hasMissingRequired ? 'Gerar Relatório (com pendências)' : 'Gerar Relatório'}
              </>
            )}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
