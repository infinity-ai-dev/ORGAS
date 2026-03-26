import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { downloadApiFile, downloadApiFileNative, downloadFile } from '@/lib/download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  RelatorioWithCliente, 
  formatCurrency, 
  formatPercent,
  useAtualizarStatusRelatorio,
  RelatorioStatus
} from '@/hooks/useRelatorios';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ApprovalDialog, ApprovalAction } from './ApprovalDialog';
import { HistoricoRevisoesTimeline } from './HistoricoRevisoesTimeline';
import { AlertasPanel } from './AlertasPanel';
import { SecaoFaturamento } from './SecaoFaturamento';
import { SecaoFinanceiro } from './SecaoFinanceiro';
import { SecaoDocumentos } from './SecaoDocumentos';
import { TabelaMensal } from './TabelaMensal';
import { ComparativoRegimes } from './ComparativoRegimes';
import { SecaoDocumentosAnalisados } from './SecaoDocumentosAnalisados';
import { SecaoAssinatura } from './SecaoAssinatura';
import { SecaoComentarioAnalista } from './SecaoComentarioAnalista';
import { RelatorioResumo } from './RelatorioResumo';
import { RelatorioPessoalTabs } from './RelatorioPessoalTabs';
import { apiFetch } from '@/lib/api';
import { 
  Building2, 
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RotateCcw,
  Download,
  Printer,
  Eye,
  LayoutDashboard,
  TrendingUp,
  Landmark,
  FileText,
  CalendarDays,
  Scale,
  FileSearch,
  PenTool,
  MessageSquareText
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RelatorioViewProps {
  relatorio: RelatorioWithCliente;
}

type DownloadFeedbackState = 'idle' | 'starting' | 'success' | 'retry' | 'error';

function parseDisplayNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return 0;

  const normalized = String(value)
    .replace(/R\$\s?/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace('%', '')
    .trim();

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDisplayPercent(value: unknown): number {
  const parsed = parseDisplayNumber(value);
  if (parsed > 1) return parsed / 100;
  return parsed;
}

const statusConfig: Record<RelatorioStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: typeof Clock }> = {
  rascunho: { label: 'Rascunho', variant: 'outline', icon: Clock },
  pendente_aprovacao: { label: 'Pendente Aprovação', variant: 'secondary', icon: Send },
  aprovado: { label: 'Aprovado', variant: 'default', icon: CheckCircle },
  rejeitado: { label: 'Rejeitado', variant: 'destructive', icon: XCircle },
};

export function RelatorioView({ relatorio }: RelatorioViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState<ApprovalAction>('aprovar');
  const [comentarioDraft, setComentarioDraft] = useState('');
  const [comentarioEditando, setComentarioEditando] = useState(false);
  const [comentarioSalvando, setComentarioSalvando] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadFeedbackState, setDownloadFeedbackState] = useState<DownloadFeedbackState>('idle');
  const [downloadFeedbackMessage, setDownloadFeedbackMessage] = useState<string | null>(null);
  const downloadRetryTimerRef = useRef<number | null>(null);
  const downloadHideTimerRef = useRef<number | null>(null);
  const isParecerPessoal =
    String(relatorio.tipo_parecer || relatorio.type || '').toLowerCase() === 'pessoal' ||
    String((relatorio.secoes_json as Record<string, unknown> | null)?.tipo || '').toUpperCase() === 'PARECER_PESSOAL';
  
  const { isAdmin, isRevisor, isAnalista } = useUserRole();
  const { user } = useAuth();
  const { toast } = useToast();
  const atualizarStatus = useAtualizarStatusRelatorio();
  const queryClient = useQueryClient();

  const clearDownloadFeedbackTimers = () => {
    if (downloadRetryTimerRef.current) {
      window.clearTimeout(downloadRetryTimerRef.current);
      downloadRetryTimerRef.current = null;
    }
    if (downloadHideTimerRef.current) {
      window.clearTimeout(downloadHideTimerRef.current);
      downloadHideTimerRef.current = null;
    }
  };

  const dismissDownloadFeedback = () => {
    clearDownloadFeedbackTimers();
    setDownloadFeedbackState('idle');
    setDownloadFeedbackMessage(null);
  };

  const showDownloadFeedback = () => {
    clearDownloadFeedbackTimers();
    setDownloadFeedbackState('starting');
    setDownloadFeedbackMessage('O download pode levar alguns segundos para começar, principalmente em PDFs maiores.');

    downloadRetryTimerRef.current = window.setTimeout(() => {
      setDownloadFeedbackState((current) => current === 'starting' ? 'retry' : current);
    }, 8000);

    downloadHideTimerRef.current = window.setTimeout(() => {
      dismissDownloadFeedback();
    }, 30000);
  };

  const showDownloadError = (message?: string) => {
    clearDownloadFeedbackTimers();
    setDownloadFeedbackState('error');
    setDownloadFeedbackMessage(message || 'Não foi possível iniciar o download. Você pode tentar novamente ou abrir a prévia do parecer.');
  };

  const markDownloadStarted = () => {
    clearDownloadFeedbackTimers();
    setDownloadFeedbackState('success');
    setDownloadFeedbackMessage('Download iniciado. Se o navegador bloquear a ação, você pode tentar novamente.');
    downloadHideTimerRef.current = window.setTimeout(() => {
      dismissDownloadFeedback();
    }, 4000);
  };

  useEffect(() => () => clearDownloadFeedbackTimers(), []);

  const fetchHtmlPreview = async () => {
    if (previewHtml) return previewHtml;
    const data = await apiFetch<{ success: boolean; html?: string }>(`/relatorios/${relatorio.id}/html`, {
      method: 'GET'
    });
    if (!data?.html) throw new Error('HTML não disponível');
    setPreviewHtml(data.html);
    return data.html;
  };

  const openHtmlPreview = async (autoPrint?: boolean) => {
    const html = await fetchHtmlPreview();
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      throw new Error('Não foi possível abrir a janela de impressão');
    }
    previewWindow.document.open();
    previewWindow.document.write(html);
    previewWindow.document.close();
    if (autoPrint) {
      setTimeout(() => {
        previewWindow.focus();
        previewWindow.print();
      }, 350);
    }
  };

  const handleTogglePreview = async () => {
    const nextVisible = !previewVisible;
    setPreviewVisible(nextVisible);
    if (nextVisible && !previewHtml && !previewLoading) {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        await fetchHtmlPreview();
      } catch (error) {
        console.error('Erro ao carregar HTML do parecer:', error);
        setPreviewError('Não foi possível carregar o HTML do parecer.');
      } finally {
        setPreviewLoading(false);
      }
    }
  };

  const handleDownloadPdf = async () => {
    showDownloadFeedback();
    try {
      await downloadApiFileNative(`/relatorios/${relatorio.id}/pdf`);
      markDownloadStarted();
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      try {
        await downloadApiFile(`/relatorios/${relatorio.id}/pdf?download=1`, `PARECER_${relatorio.id}.pdf`);
        markDownloadStarted();
      } catch (directDownloadError) {
        console.error('Erro ao gerar PDF (download direto):', directDownloadError);
        try {
          const data = await apiFetch<{ success: boolean; url: string; fileName?: string | null }>(`/relatorios/${relatorio.id}/pdf`, {
            method: 'GET'
          });
          if (!data?.url) {
            throw new Error('PDF não disponível');
          }
          try {
            await downloadFile(data.url, data.fileName || undefined);
            markDownloadStarted();
          } catch (downloadError) {
            console.warn('Falha ao baixar PDF, abrindo em nova guia:', downloadError);
            window.open(data.url, '_blank');
            markDownloadStarted();
          }
        } catch (fallbackError) {
          console.error('Erro ao gerar PDF (fallback):', fallbackError);
          showDownloadError();
          toast({
            title: 'Download não iniciado',
            description: 'O PDF não começou a baixar. Use o retry na página ou abra a prévia do parecer.',
            variant: 'destructive',
          });
          try {
            await openHtmlPreview(false);
          } catch (previewError) {
            console.error('Erro ao abrir pré-visualização:', previewError);
          }
        }
      }
    }
  };

  const handlePrintPdf = async () => {
    try {
      await openHtmlPreview(true);
    } catch (error) {
      console.error('Erro ao imprimir HTML:', error);
      await handleDownloadPdf();
    }
  };

  const status = statusConfig[relatorio.status as RelatorioStatus] || statusConfig.rascunho;
  const StatusIcon = status.icon;

  const openDialog = (action: ApprovalAction) => {
    setCurrentAction(action);
    setDialogOpen(true);
  };

  const handleConfirmAction = async (comentario: string) => {
    if (!user) return;

    const actionToStatus: Record<ApprovalAction, RelatorioStatus> = {
      enviar_aprovacao: 'pendente_aprovacao',
      aprovar: 'aprovado',
      rejeitar: 'rejeitado',
      reabrir: 'rascunho',
    };

    const novoStatus = actionToStatus[currentAction];
    
    await atualizarStatus.mutateAsync({
      id: relatorio.id,
      status: novoStatus,
      observacoes: comentario || undefined,
      aprovadoPor: currentAction === 'aprovar' ? user.id : undefined,
    });

    setDialogOpen(false);
  };

  // Parse JSONB sections
  const secao1 = relatorio.secao1_faturamento as Record<string, unknown> | null;
  const secao2 = relatorio.secao2_financeiro as Record<string, unknown> | null;
  const secao3 = relatorio.secao3_documentos as Record<string, unknown> | null;
  const secao4 = relatorio.secao4_tabela_mensal as Array<Record<string, unknown>> | null;
  const secao5 = relatorio.secao5_acompanham as Array<Record<string, unknown>> | null;
  const secao6 = relatorio.secao6_analisados as Array<Record<string, unknown>> | null;
  const secao7 = relatorio.secao7_tributaria as Record<string, unknown> | null;
  const secao8 = relatorio.secao8_assinatura as Record<string, unknown> | null;
  const secao9 = relatorio.secao9_analista as Record<string, unknown> | null;
  const alertas = relatorio.alertas as Array<Record<string, unknown>> | null;

  // Build section data with fallbacks
  const estabelecimentosRaw = (secao1?.estabelecimentos as Array<Record<string, unknown>>) || [];
  const estabelecimentos = estabelecimentosRaw.map(e => ({
    tipo: String(e.tipo || 'MATRIZ'),
    cnpj: String(e.cnpj || ''),
    receita: Number(e.receita) || 0,
    aliquota: Number(e.aliquota) || 0,
    imposto: Number(e.imposto) || 0,
  }));

  const secaoFaturamentoData = {
    receitaBrutaMes: relatorio.receita_bruta_mes || 0,
    rbt12: relatorio.receita_bruta_12_meses || 0,
    anexo: relatorio.simples_anexo || 'III',
    fatorR: relatorio.fator_r,
    anexoEfetivo: relatorio.anexo_efetivo || relatorio.simples_anexo || 'III',
    estabelecimentos,
    aliquotaNominal: Number(secao1?.aliquotaNominal) || relatorio.simples_aliquota_efetiva || 0,
    aliquotaEfetiva: relatorio.simples_aliquota_efetiva || 0,
    deducao: relatorio.simples_deducao || 0,
    impostoDevido: relatorio.simples_valor_devido || 0,
  };

  const secaoFinanceiroData = {
    vendasCartao: (secao2?.vendasCartao as Array<{ operadora: string; valor: number }>) || [],
    totalCartao: Number(secao2?.totalCartao) || 0,
    pixRecebidos: Number(secao2?.pixRecebidos) || 0,
    qtdPix: Number(secao2?.qtdPix) || 0,
    transferenciasRecebidas: Number(secao2?.transferenciasRecebidas) || 0,
    transferenciasMesmaTitularidade: Number(secao2?.transferenciasMesmaTitularidade) || 0,
    totalMovimento: Number(secao2?.totalMovimento) || 0,
    receitaDeclarada: relatorio.receita_bruta_mes || 0,
    divergencia: Number(secao2?.divergencia) || 0,
  };

  const impostosRetidosRaw = (secao3?.impostos_retidos as Record<string, unknown>) || {};
  const secaoDocumentosData = {
    totalNotasEmitidas: relatorio.total_notas_emitidas || 0,
    valorNotasEmitidas: relatorio.valor_notas_emitidas || 0,
    totalNotasCanceladas: Number(secao3?.totalNotasCanceladas) || 0,
    valorNotasCanceladas: Number(secao3?.valorNotasCanceladas) || 0,
    totalNotasRecebidas: relatorio.total_notas_recebidas || 0,
    valorNotasRecebidas: relatorio.valor_notas_recebidas || 0,
    impostos_retidos: {
      iss: Number(impostosRetidosRaw.iss) || 0,
      irrf: Number(impostosRetidosRaw.irrf) || 0,
      pis: Number(impostosRetidosRaw.pis) || 0,
      cofins: Number(impostosRetidosRaw.cofins) || 0,
      csll: Number(impostosRetidosRaw.csll) || 0,
      inss: Number(impostosRetidosRaw.inss) || 0,
    },
    totalRetido: relatorio.total_impostos_retidos || 0,
    comprasMes: relatorio.total_compras || 0,
  };

  const tabelaMensalData = (secao4 || []).map(item => ({
    mes: String(item.mes) || '',
    receita: Number(item.receita) || 0,
    imposto: Number(item.imposto) || 0,
    folha: Number(item.folha) || 0,
    compras: Number(item.compras) || 0,
    lucro: Number(item.lucro) || 0,
  }));

  const simplesAnexoIIIRaw =
    (secao7?.simplesNacionalAnexoIII as Record<string, unknown>) ||
    (secao7?.simplesAnexoIII as Record<string, unknown>) ||
    {};
  const simplesAnexoVRaw =
    (secao7?.simplesNacionalAnexoV as Record<string, unknown>) ||
    (secao7?.simplesAnexoV as Record<string, unknown>) ||
    {};
  const simplesAnexoIIIValor =
    parseDisplayNumber(simplesAnexoIIIRaw.imposto ?? simplesAnexoIIIRaw.valor) ||
    relatorio.simples_valor_devido ||
    0;
  const simplesAnexoVValor =
    parseDisplayNumber(simplesAnexoVRaw.imposto ?? simplesAnexoVRaw.valor) ||
    (relatorio.simples_valor_devido || 0) * 1.15;
  const comparativoValores = [
    simplesAnexoIIIValor,
    simplesAnexoVValor,
    relatorio.presumido_total || 0,
  ].filter((value) => value > 0);
  const economiaComparativa =
    comparativoValores.length > 1
      ? Math.max(...comparativoValores) - Math.min(...comparativoValores)
      : 0;

  const comparativoData = {
    simplesAnexoIII: {
      nome: 'Simples Anexo III',
      aliquota:
        parseDisplayPercent(simplesAnexoIIIRaw.aliquota ?? simplesAnexoIIIRaw.aliquotaFormatada) ||
        relatorio.simples_aliquota_efetiva ||
        0,
      valorDevido: simplesAnexoIIIValor,
      detalhes: [
        { tributo: 'IRPJ', valor: relatorio.simples_irpj || 0 },
        { tributo: 'CSLL', valor: relatorio.simples_csll || 0 },
        { tributo: 'COFINS', valor: relatorio.simples_cofins || 0 },
        { tributo: 'PIS', valor: relatorio.simples_pis || 0 },
        { tributo: 'CPP', valor: relatorio.simples_cpp || 0 },
        { tributo: 'ISS', valor: relatorio.simples_iss || 0 },
      ],
    },
    simplesAnexoV: {
      nome: 'Simples Anexo V',
      aliquota:
        parseDisplayPercent(simplesAnexoVRaw.aliquota ?? simplesAnexoVRaw.aliquotaFormatada) ||
        (relatorio.simples_aliquota_efetiva || 0) * 1.15,
      valorDevido: simplesAnexoVValor,
      detalhes: [],
    },
    lucroPresumido: {
      nome: 'Lucro Presumido',
      aliquota: relatorio.presumido_total > 0 && relatorio.receita_bruta_mes > 0 
        ? relatorio.presumido_total / relatorio.receita_bruta_mes 
        : 0,
      valorDevido: relatorio.presumido_total || 0,
      detalhes: [
        { tributo: 'IRPJ', valor: relatorio.presumido_irpj || 0 },
        { tributo: 'CSLL', valor: relatorio.presumido_csll || 0 },
        { tributo: 'COFINS', valor: relatorio.presumido_cofins || 0 },
        { tributo: 'PIS', valor: relatorio.presumido_pis || 0 },
        { tributo: 'ISS', valor: relatorio.presumido_iss || 0 },
      ],
    },
    regimeRecomendado: relatorio.regime_tributario_selecionado || 'Simples Nacional',
    fatorR: relatorio.fator_r,
    economiaTotal: economiaComparativa || relatorio.economia_vs_presumido || Math.abs(relatorio.presumido_total - relatorio.simples_valor_devido),
  };

  const documentosAnalisados = (secao6 || []).map(doc => ({
    nome: String(doc.nome) || '',
    tipo: String(doc.tipo) || 'outro',
    status: (doc.status as 'processado' | 'erro' | 'pendente') || 'processado',
    confianca: Number(doc.confianca) || 0.95,
    dataProcessamento: String(doc.dataProcessamento) || new Date().toISOString(),
  }));

  const documentosAcompanham = (secao5 || []).map(doc => ({
    nome: String(doc.nome) || '',
    obrigatorio: Boolean(doc.obrigatorio),
    presente: Boolean(doc.presente),
  }));

  const assinaturaData = {
    empresa: {
      razaoSocial: relatorio.clientes_pj.razao_social,
      cnpj: relatorio.clientes_pj.cnpj,
    },
    responsavel: {
      nome: (secao8?.responsavel as Record<string, unknown>)?.nome as string || 'Responsável Técnico',
      cargo: (secao8?.responsavel as Record<string, unknown>)?.cargo as string || 'Contador',
      crc: (secao8?.responsavel as Record<string, unknown>)?.crc as string || undefined,
    },
    dataEmissao: relatorio.gerado_em,
    dataAprovacao: relatorio.aprovado_em || undefined,
    aprovadoPor: relatorio.aprovado_por || undefined,
    observacoes: relatorio.observacoes || undefined,
  };

  const comentarioAnalista = String(secao9?.comentario || secao9?.observacoes || '').trim();
  const comentarioDataRaw = secao9?.dataComentario ?? relatorio.aprovado_em ?? null;
  const comentarioAnalistaData = {
    titulo: String(secao9?.titulo || 'Comentário do Analista'),
    comentario: comentarioAnalista,
    analista: String(secao9?.analista || relatorio.aprovado_por || ''),
    dataComentario: comentarioDataRaw ? String(comentarioDataRaw) : null,
  };
  const hasComentarioAnalista = !!comentarioAnalista;
  const canEditComentario = isAnalista || isRevisor || isAdmin;

  const startEditarComentario = () => {
    setComentarioDraft(comentarioAnalista || '');
    setComentarioEditando(true);
  };

  const handleSalvarComentario = async () => {
    if (!user) return;
    const texto = comentarioDraft.trim();
    if (!texto) return;
    setComentarioSalvando(true);
    try {
      await apiFetch(`/relatorios/${relatorio.id}/comentario`, {
        method: 'POST',
        body: {
          comentario: texto,
          analista_nome: user.nome || user.email || undefined,
        }
      });
      setComentarioEditando(false);
      queryClient.invalidateQueries({ queryKey: ['relatorio', relatorio.id] });
      queryClient.invalidateQueries({ queryKey: ['relatorios'] });
      queryClient.invalidateQueries({ queryKey: ['historico-revisoes', relatorio.id] });
    } catch (error) {
      console.error('Erro ao salvar comentário do analista:', error);
    } finally {
      setComentarioSalvando(false);
    }
  };

  const comentarioTabContent = (
    <div className="space-y-4">
      <SecaoComentarioAnalista data={comentarioAnalistaData} />
      {canEditComentario && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {comentarioEditando ? 'Editar comentário' : 'Adicionar comentário'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {comentarioEditando ? (
              <>
                <Textarea
                  value={comentarioDraft}
                  onChange={(event) => setComentarioDraft(event.target.value)}
                  placeholder="Escreva o comentário do analista..."
                  className="min-h-[120px]"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleSalvarComentario}
                    disabled={comentarioSalvando || !comentarioDraft.trim()}
                  >
                    {comentarioSalvando ? 'Salvando...' : 'Salvar comentário'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setComentarioEditando(false)}
                    disabled={comentarioSalvando}
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" onClick={startEditarComentario}>
                {hasComentarioAnalista ? 'Atualizar comentário' : 'Adicionar comentário'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );

  const alertasData = (alertas || []).map(a => ({
    tipo: String(a.tipo) || 'INFO',
    mensagem: String(a.mensagem) || '',
    nivel: (a.nivel as 'CRITICO' | 'ALERTA' | 'INFO' | 'OK') || 'INFO',
    detalhes: a.detalhes ? String(a.detalhes) : undefined,
  }));

  const hasSecao1Data = secao1 || relatorio.receita_bruta_mes > 0;
  const hasSecao2Data = secao2 && (Number(secao2.totalCartao) > 0 || Number(secao2.pixRecebidos) > 0);
  const hasSecao4Data = tabelaMensalData.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-xl">{relatorio.clientes_pj.razao_social}</CardTitle>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>CNPJ: {relatorio.clientes_pj.cnpj}</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Competência: {relatorio.competencia}
                </span>
              </div>
            </div>
            <Badge variant={status.variant} className="flex items-center gap-1">
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {/* PDF/Print Buttons */}
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleDownloadPdf}
            >
              <Download className="mr-2 h-4 w-4" />
              Baixar PDF
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handlePrintPdf}
            >
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleTogglePreview}
              disabled={previewLoading}
            >
              <Eye className="mr-2 h-4 w-4" />
              {previewVisible ? 'Ocultar Prévia' : 'Ver Parecer'}
            </Button>

            {/* Workflow Buttons */}
            {relatorio.status === 'rascunho' && (
              <Button 
                size="sm" 
                onClick={() => openDialog('enviar_aprovacao')}
                disabled={atualizarStatus.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                Enviar para Aprovação
              </Button>
            )}
            {relatorio.status === 'pendente_aprovacao' && (isAdmin || isRevisor) && (
              <>
                <Button 
                  size="sm" 
                  onClick={() => openDialog('aprovar')}
                  disabled={atualizarStatus.isPending}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aprovar
                </Button>
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={() => openDialog('rejeitar')}
                  disabled={atualizarStatus.isPending}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Rejeitar
                </Button>
              </>
            )}
            {(relatorio.status === 'aprovado' || relatorio.status === 'rejeitado') && isAdmin && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => openDialog('reabrir')}
                disabled={atualizarStatus.isPending}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reabrir para Revisão
              </Button>
        )}
          </div>
          {downloadFeedbackState !== 'idle' && (
            <Alert
              variant={downloadFeedbackState === 'error' ? 'destructive' : 'default'}
              className="mt-3"
            >
              <Clock className="h-4 w-4" />
              <AlertTitle>
                {downloadFeedbackState === 'error'
                  ? 'Falha ao iniciar download'
                  : downloadFeedbackState === 'success'
                    ? 'Download iniciado'
                    : 'Preparando download'}
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  {downloadFeedbackState === 'retry'
                    ? 'Se o download ainda não começou, use o retry abaixo.'
                    : downloadFeedbackMessage}
                </span>
                {(downloadFeedbackState === 'retry' || downloadFeedbackState === 'error') && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={handleDownloadPdf}
                  >
                    Tentar novamente
                  </Button>
                )}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={dismissDownloadFeedback}
                >
                  Fechar aviso
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {!isParecerPessoal && <AlertasPanel alertas={alertasData} />}

      {previewVisible && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prévia do Parecer (HTML)</CardTitle>
          </CardHeader>
          <CardContent>
            {previewLoading && <p className="text-sm text-muted-foreground">Carregando HTML...</p>}
            {previewError && <p className="text-sm text-destructive">{previewError}</p>}
            {!previewLoading && !previewError && previewHtml && (
              <iframe
                title="Prévia do parecer"
                srcDoc={previewHtml}
                className="w-full min-h-[80vh] rounded-md border bg-white"
                sandbox=""
              />
            )}
          </CardContent>
        </Card>
      )}

      {isParecerPessoal ? (
        <RelatorioPessoalTabs
          relatorio={relatorio}
          comentarioContent={comentarioTabContent}
          showComentarioTab={hasComentarioAnalista || canEditComentario}
        />
      ) : (
        <Tabs defaultValue="resumo" className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="resumo" className="flex items-center gap-1">
              <LayoutDashboard className="h-4 w-4" />
              Resumo
            </TabsTrigger>
            <TabsTrigger value="faturamento" className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Faturamento
            </TabsTrigger>
            {hasSecao2Data && (
              <TabsTrigger value="financeiro" className="flex items-center gap-1">
                <Landmark className="h-4 w-4" />
                Financeiro
              </TabsTrigger>
            )}
            <TabsTrigger value="documentos" className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              Documentos
            </TabsTrigger>
            {hasSecao4Data && (
              <TabsTrigger value="historico" className="flex items-center gap-1">
                <CalendarDays className="h-4 w-4" />
                Histórico
              </TabsTrigger>
            )}
            <TabsTrigger value="comparativo" className="flex items-center gap-1">
              <Scale className="h-4 w-4" />
              Comparativo
            </TabsTrigger>
            <TabsTrigger value="anexos" className="flex items-center gap-1">
              <FileSearch className="h-4 w-4" />
              Anexos
            </TabsTrigger>
            <TabsTrigger value="assinatura" className="flex items-center gap-1">
              <PenTool className="h-4 w-4" />
              Assinatura
            </TabsTrigger>
            {(hasComentarioAnalista || canEditComentario) && (
              <TabsTrigger value="comentario" className="flex items-center gap-1">
                <MessageSquareText className="h-4 w-4" />
                Comentário
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="resumo" className="mt-4">
            <RelatorioResumo relatorio={relatorio} />
          </TabsContent>

          <TabsContent value="faturamento" className="mt-4">
            <SecaoFaturamento data={secaoFaturamentoData} competencia={relatorio.competencia} />
          </TabsContent>

          {hasSecao2Data && (
            <TabsContent value="financeiro" className="mt-4">
              <SecaoFinanceiro data={secaoFinanceiroData} />
            </TabsContent>
          )}

          <TabsContent value="documentos" className="mt-4">
            <SecaoDocumentos data={secaoDocumentosData} />
          </TabsContent>

          {hasSecao4Data && (
            <TabsContent value="historico" className="mt-4">
              <TabelaMensal dados={tabelaMensalData} mesAtual={relatorio.competencia} />
            </TabsContent>
          )}

          <TabsContent value="comparativo" className="mt-4">
            <ComparativoRegimes {...comparativoData} />
          </TabsContent>

          <TabsContent value="anexos" className="mt-4">
            <SecaoDocumentosAnalisados analisados={documentosAnalisados} acompanham={documentosAcompanham} />
          </TabsContent>

          <TabsContent value="assinatura" className="mt-4">
            <SecaoAssinatura data={assinaturaData} />
          </TabsContent>

          {(hasComentarioAnalista || canEditComentario) && (
            <TabsContent value="comentario" className="mt-4">
              {comentarioTabContent}
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Histórico de Revisões */}
      {relatorio.status !== 'pendente_aprovacao' && (
        <HistoricoRevisoesTimeline relatorioId={relatorio.id} />
      )}

      {/* Dialog de Aprovação */}
      <ApprovalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={currentAction}
        onConfirm={handleConfirmAction}
        isPending={atualizarStatus.isPending}
      />
    </div>
  );
}
