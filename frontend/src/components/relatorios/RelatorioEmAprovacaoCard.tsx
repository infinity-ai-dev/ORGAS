import {
  PareceiFiscalResponse,
  ParecePersonalResponse,
  RelatorioEmAprovacao,
  isPareceiFiscal,
  isParecerPersonal,
} from '@/hooks/useRelatoriosEmAprovacao';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertCircle,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Eye,
  FileText,
  Files,
  ReceiptText,
  Scale,
  TriangleAlert,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RelatorioEmAprovacaoCardProps {
  relatorio: RelatorioEmAprovacao;
  onViewDetails?: (id: string) => void;
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const documentTypeLabels: Record<string, string> = {
  folha_pagamento: 'Folha',
  irrf: 'IRRF',
  ponto: 'Ponto',
  eventos: 'Eventos',
  consignado: 'Consignado',
  sem_tipo: 'Sem tipo',
};

function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/[R$\s]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function getTipoParecerLabel(tipo: string): string {
  const labels: Record<string, string> = {
    fiscal: 'Parecer Fiscal',
    tax: 'Parecer Fiscal',
    personal: 'Parecer Pessoal',
    pessoal: 'Parecer Pessoal',
    accounting: 'Parecer Contábil',
    contabil: 'Parecer Contábil',
    contábil: 'Parecer Contábil',
    support: 'Parecer de Atendimento',
    atendimento: 'Parecer de Atendimento',
    generico: 'Relatório Genérico',
    generic: 'Relatório Genérico',
  };
  return labels[(tipo || '').toLowerCase()] || tipo || 'Relatório';
}

function getStatusBadge(responseData: RelatorioEmAprovacao['response_data']): {
  variant: BadgeVariant;
  label: string;
} {
  if (responseData.status === 'error') {
    return { variant: 'destructive', label: 'Erro' };
  }
  if (!responseData.is_valid) {
    return { variant: 'secondary', label: 'Com ressalvas' };
  }
  if (responseData.status === 'pending') {
    return { variant: 'outline', label: 'Pendente' };
  }
  return { variant: 'default', label: 'Válido' };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return String(
          record.mensagem ||
            record.message ||
            record.descricao ||
            record.label ||
            ''
        ).trim();
      }
      return '';
    })
    .filter(Boolean);
}

function truncateText(text: string | undefined, maxLength: number): string | null {
  const normalized = (text || '').trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function extractFiscalMetrics(responseData: PareceiFiscalResponse) {
  const receita = parseNumber(
    responseData.receita_bruta?.valor ??
      responseData.receita_bruta ??
      responseData.fiscal_data?.receita_bruta?.valor ??
      responseData.fiscal_data?.receita_bruta ??
      responseData.fiscal_data?.receita_bruta_mes ??
      responseData.fiscal_data?.receita_bruta_2024
  );
  const impostoDevido = parseNumber(
    responseData.impostos?.devido ??
      responseData.imposto_devido ??
      responseData.fiscal_data?.simples_valor_devido ??
      responseData.fiscal_data?.imposto_devido ??
      responseData.fiscal_data?.imposto_devido_2024
  );
  const impostoPago = parseNumber(
    responseData.impostos?.pago ??
      responseData.imposto_pago ??
      responseData.fiscal_data?.imposto_pago ??
      responseData.fiscal_data?.imposto_pago_2024
  );
  const diferenca = impostoDevido || impostoPago
    ? impostoDevido - impostoPago
    : parseNumber(
        responseData.impostos?.diferenca ??
          responseData.diferenca ??
          responseData.fiscal_data?.diferenca
      );

  return {
    receita,
    impostoDevido,
    impostoPago,
    diferenca,
    regime:
      responseData.regime_tributario ||
      responseData.fiscal_data?.regime_tributario ||
      'Não informado',
    periodo:
      responseData.receita_bruta?.periodo ||
      responseData.competencia ||
      responseData.periodo ||
      responseData.fiscal_data?.competencia ||
      responseData.fiscal_data?.periodo ||
      'Não informado',
    obrigacoes:
      (Array.isArray(responseData.obrigacoes_acessorias) &&
        responseData.obrigacoes_acessorias.length) ||
      (Array.isArray(responseData.fiscal_data?.obrigacoes_acessorias) &&
        responseData.fiscal_data.obrigacoes_acessorias.length) ||
      0,
  };
}

function extractPersonalMetrics(responseData: ParecePersonalResponse, relatorio: RelatorioEmAprovacao) {
  const documentosRecebidos = Array.isArray(responseData.documentos_recebidos)
    ? responseData.documentos_recebidos
    : [];
  const documentosPorTipo =
    responseData.documentos_por_tipo && typeof responseData.documentos_por_tipo === 'object'
      ? responseData.documentos_por_tipo
      : {};
  const documentosSemTexto = Array.isArray(responseData.documentos_sem_texto)
    ? responseData.documentos_sem_texto
    : documentosRecebidos
        .filter((documento) => documento && documento.texto_extraido === false)
        .map((documento) => documento.nome)
        .filter(Boolean);
  const pendenciasObrigatorias = normalizeStringList(
    responseData.missing_required_documents
  );
  const alertas = normalizeStringList(responseData.alertas);

  return {
    competencia: responseData.competencia || 'Não identificada',
    clienteCnpj: responseData.cliente_cnpj || 'Não identificado',
    documentosAnalisados:
      responseData.documentos_analisados ??
      relatorio.documentos_analisados ??
      documentosRecebidos.length,
    documentosPorTipo,
    documentosSemTexto,
    pendenciasObrigatorias,
    alertas,
    resumoCurto: truncateText(responseData.personal_summary, 260),
  };
}

function renderListBlock(
  title: string,
  items: string[],
  variant: 'danger' | 'warning' | 'info'
) {
  if (items.length === 0) return null;

  const styles = {
    danger:
      'border-destructive/20 bg-destructive/10 text-destructive',
    warning:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    info:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  } as const;

  return (
    <div className={`rounded-lg border p-3 ${styles[variant]}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <TriangleAlert className="h-4 w-4" />
        {title}
      </div>
      <ul className="ml-6 space-y-1 text-xs">
        {items.slice(0, 3).map((item, index) => (
          <li key={`${title}-${index}`} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RelatorioEmAprovacaoCard({
  relatorio,
  onViewDetails,
}: RelatorioEmAprovacaoCardProps) {
  const responseData = relatorio.response_data;
  const frontendVariant =
    relatorio.frontend_variant ||
    responseData.frontend_variant ||
    responseData.tipo_parecer ||
    relatorio.tipo_parecer;
  const isFiscal = frontendVariant === 'fiscal' || isPareceiFiscal(responseData);
  const isPersonal = frontendVariant === 'pessoal' || isParecerPersonal(responseData);
  const fiscalResponse = responseData as PareceiFiscalResponse;
  const personalResponse = responseData as ParecePersonalResponse;
  const statusBadge = getStatusBadge(responseData);
  const validationErrors = normalizeStringList(
    (responseData as any).validation_errors || (responseData as any).validacao_erros
  );
  const recommendations = normalizeStringList((responseData as any).recommendations);
  const risks = normalizeStringList((responseData as any).risks_identified);

  const fiscalMetrics = isFiscal ? extractFiscalMetrics(fiscalResponse) : null;
  const personalMetrics = isPersonal
    ? extractPersonalMetrics(personalResponse, relatorio)
    : null;

  const coveragePercentage =
    fiscalMetrics && fiscalMetrics.impostoDevido > 0
      ? Math.min(
          100,
          Math.max(0, (fiscalMetrics.impostoPago / fiscalMetrics.impostoDevido) * 100)
        )
      : 0;

  return (
    <Card className="border-border/60 shadow-sm transition-all hover:border-border hover:shadow-lg">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              {relatorio.cliente_nome || 'Cliente não informado'}
            </CardTitle>
            <CardDescription>
              {relatorio.tipo_parecer_label || getTipoParecerLabel(frontendVariant)}
            </CardDescription>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{responseData.agent}</Badge>
              <Badge variant="outline">{responseData.step}</Badge>
              {relatorio.data_geracao && (
                <Badge variant="outline">
                  {format(new Date(relatorio.data_geracao), "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </Badge>
              )}
            </div>
          </div>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isFiscal && fiscalMetrics && (
          <div className="space-y-4 rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-background to-background p-4 dark:border-emerald-900/70 dark:from-emerald-950/40">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{fiscalMetrics.regime}</Badge>
              <Badge variant="outline">
                <CalendarRange className="mr-1 h-3 w-3" />
                {fiscalMetrics.periodo}
              </Badge>
              {fiscalMetrics.obrigacoes > 0 && (
                <Badge variant="outline">
                  <ReceiptText className="mr-1 h-3 w-3" />
                  {fiscalMetrics.obrigacoes} obrigação(ões)
                </Badge>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Receita apurada</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(fiscalMetrics.receita)}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Imposto devido</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(fiscalMetrics.impostoDevido)}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Imposto pago</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(fiscalMetrics.impostoPago)}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Diferença</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    fiscalMetrics.diferenca > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {formatCurrency(Math.abs(fiscalMetrics.diferenca))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fiscalMetrics.diferenca > 0 ? 'A recolher' : 'Cobertura suficiente'}
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-background/70 p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <BarChart3 className="h-4 w-4" />
                  Comparativo recolhido x devido
                </div>
                <span className="text-muted-foreground">
                  {coveragePercentage.toFixed(0)}% coberto
                </span>
              </div>
              <Progress value={coveragePercentage} className="h-2.5" />
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Pago: {formatCurrency(fiscalMetrics.impostoPago)}</span>
                <span>Devido: {formatCurrency(fiscalMetrics.impostoDevido)}</span>
              </div>
            </div>
          </div>
        )}

        {isPersonal && personalMetrics && (
          <div className="space-y-4 rounded-xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-background to-background p-4 dark:border-sky-900/70 dark:from-sky-950/40">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Competência</div>
                <div className="mt-1 text-base font-semibold">{personalMetrics.competencia}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">CNPJ</div>
                <div className="mt-1 text-base font-semibold">{personalMetrics.clienteCnpj}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Documentos analisados</div>
                <div className="mt-1 text-lg font-semibold">{personalMetrics.documentosAnalisados}</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-xs text-muted-foreground">Pendências visíveis</div>
                <div className="mt-1 text-lg font-semibold">
                  {personalMetrics.pendenciasObrigatorias.length + personalMetrics.documentosSemTexto.length}
                </div>
              </div>
            </div>

            {Object.keys(personalMetrics.documentosPorTipo).length > 0 && (
              <div className="rounded-lg border bg-background/70 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Files className="h-4 w-4" />
                  Documentos por tipo
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(personalMetrics.documentosPorTipo).map(([tipo, quantidade]) => (
                    <Badge key={tipo} variant="outline">
                      {documentTypeLabels[tipo] || tipo}: {quantidade}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {personalMetrics.resumoCurto && (
              <div className="rounded-lg border bg-background/70 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Scale className="h-4 w-4" />
                  Síntese do parecer
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {personalMetrics.resumoCurto}
                </p>
              </div>
            )}

            {renderListBlock(
              'Documentos obrigatórios pendentes',
              personalMetrics.pendenciasObrigatorias,
              'warning'
            )}
            {renderListBlock(
              'Arquivos sem texto extraível',
              personalMetrics.documentosSemTexto,
              'warning'
            )}
            {renderListBlock('Alertas do agente', personalMetrics.alertas, 'info')}
          </div>
        )}

        {!isFiscal && !isPersonal && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Card genérico. Abra os detalhes para revisar a resposta completa do agente.
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              Erros de validação
            </div>
            <ul className="ml-6 space-y-1 text-xs text-destructive">
              {validationErrors.slice(0, 3).map((error, idx) => (
                <li key={`validation-${idx}`} className="list-disc">
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
              <CheckCircle2 className="h-4 w-4" />
              Recomendações
            </div>
            <ul className="ml-6 space-y-1 text-xs text-blue-700 dark:text-blue-300">
              {recommendations.slice(0, 3).map((recommendation, idx) => (
                <li key={`recommendation-${idx}`} className="list-disc">
                  {recommendation}
                </li>
              ))}
            </ul>
          </div>
        )}

        {risks.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              <TriangleAlert className="h-4 w-4" />
              Riscos identificados
            </div>
            <ul className="ml-6 space-y-1 text-xs text-amber-700 dark:text-amber-300">
              {risks.slice(0, 3).map((risk, idx) => (
                <li key={`risk-${idx}`} className="list-disc">
                  {risk}
                </li>
              ))}
            </ul>
          </div>
        )}

        {onViewDetails && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails(relatorio.id)}
            className="w-full"
          >
            <Eye className="mr-2 h-4 w-4" />
            Ver Detalhes Completos
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
