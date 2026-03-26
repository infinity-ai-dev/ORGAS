import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Calendar,
  Wallet,
  Clock,
  Users,
  AlertTriangle,
  Paperclip,
  MessageSquareText,
  FileText
} from 'lucide-react';
import { RelatorioWithCliente } from '@/hooks/useRelatorios';

type RelatorioPessoalTabsProps = {
  relatorio: RelatorioWithCliente;
  comentarioContent?: ReactNode;
  showComentarioTab?: boolean;
};

const normalizeArray = (value: unknown) => (Array.isArray(value) ? value : []);

const normalizeString = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeUniqueTextList = (values: unknown[]) => {
  const seen = new Set<string>();

  return values
    .map((value) => normalizeString(renderItemText(value)))
    .filter((value) => {
      if (!value) return false;

      const key = value.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const isPlaceholderName = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === 'cliente' || normalized === 'não informado' || normalized === 'nao informado';
};

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const isValidCnpj = (value: string) => {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
};

const pickName = (primary?: unknown, fallback?: unknown) => {
  const primaryValue = normalizeString(primary);
  if (primaryValue && !isPlaceholderName(primaryValue)) return primaryValue;
  const fallbackValue = normalizeString(fallback);
  return fallbackValue || '-';
};

const pickCnpj = (primary?: unknown, fallback?: unknown) => {
  const primaryValue = normalizeString(primary);
  if (primaryValue && isValidCnpj(primaryValue)) return primaryValue;
  const fallbackValue = normalizeString(fallback);
  return fallbackValue || '-';
};

const renderItemText = (item: unknown) => {
  if (item === null || item === undefined) return '-';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    return (
      String(obj.descricao || obj.nome || obj.titulo || obj.tipo || obj.evento || obj.motivo || '') ||
      JSON.stringify(obj)
    );
  }
  return String(item);
};

const parseBrNumber = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: unknown) =>
  parseBrNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const parseDurationToMinutes = (value: unknown) => {
  if (typeof value === 'number') return Math.round(value * 60);
  if (!value) return 0;
  const raw = String(value).trim();
  if (raw.includes(':')) {
    const [h, m] = raw.split(':').map((item) => Number(item));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }
  const numeric = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
};

const formatMinutes = (minutes: number) => {
  if (!minutes) return '0:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
};

export function RelatorioPessoalTabs({
  relatorio,
  comentarioContent,
  showComentarioTab
}: RelatorioPessoalTabsProps) {
  const secoesJson = (relatorio.secoes_json || {}) as Record<string, any>;
  const analisePrevia = (secoesJson.analise_previa || {}) as Record<string, any>;
  const calcFallback =
    analisePrevia.calculosIA ||
    analisePrevia.calculosIa ||
    analisePrevia.calculos ||
    analisePrevia.resultado ||
    {};

  const pickSection = (primary?: Record<string, any>, fallback?: Record<string, any>) => {
    if (primary && typeof primary === 'object' && Object.keys(primary).length > 0) return primary;
    if (fallback && typeof fallback === 'object') return fallback;
    return {};
  };

  const dadosCabecalho = pickSection(secoesJson.dadosCabecalho, calcFallback.dadosCabecalho);
  const valoresPagamento = pickSection(secoesJson.valoresPagamento, calcFallback.valoresPagamento);
  const controleJornada = pickSection(secoesJson.controleJornada, calcFallback.controleJornada);
  const alteracoesMes = pickSection(secoesJson.alteracoesMes, calcFallback.alteracoesMes);
  const eventosDP = pickSection(secoesJson.eventosDP, calcFallback.eventosDP);
  const consignado = pickSection(secoesJson.consignado, calcFallback.consignado);
  const pontosAtencao = pickSection(secoesJson.pontosAtencao, calcFallback.pontosAtencao);
  const avisosPendencias = pickSection(secoesJson.avisosPendencias, calcFallback.avisosPendencias);
  const anexos = pickSection(secoesJson.anexos, calcFallback.anexos);
  const comentarios = pickSection(secoesJson.comentarios, calcFallback.comentarios);
  const resultados = normalizeArray(analisePrevia.resultados);
  const folhas = resultados.filter((item: any) => item?.agenteProcessador === 'AGENTE_3_FOLHA');

  const pagamentos = normalizeArray(valoresPagamento.itens);
  const pendenciasJornada = normalizeArray(controleJornada.pendencias);
  const jornadasBase = normalizeArray(controleJornada.jornadas);
  const jornadasDocs = resultados.filter((item: any) => item?.agenteProcessador === 'AGENTE_5_JORNADA');
  const eventosFromDocs = jornadasDocs.reduce(
    (acc: any, doc: any) => {
      const eventosDoc = doc?.eventosDP || doc?.eventos || {};
      acc.ferias.push(...normalizeArray(eventosDoc.ferias));
      acc.desligamentos.push(...normalizeArray(eventosDoc.desligamentos));
      acc.admissoes.push(...normalizeArray(eventosDoc.admissoes));
      acc.afastamentos.push(...normalizeArray(eventosDoc.afastamentos));
      return acc;
    },
    { ferias: [], desligamentos: [], admissoes: [], afastamentos: [] }
  );
  const alteracoesFromDocs = jornadasDocs.reduce(
    (acc: any, doc: any) => {
      const alteracoesDoc = doc?.alteracoesMes || {};
      const comparativo = alteracoesDoc?.comparativo || {};
      acc.comparativo = acc.comparativo || {};
      acc.comparativo.mesAnterior = acc.comparativo.mesAnterior || comparativo.mesAnterior;
      acc.comparativo.mesAtual = acc.comparativo.mesAtual || comparativo.mesAtual;
      acc.comparativo.variacaoPercentual =
        acc.comparativo.variacaoPercentual || comparativo.variacaoPercentual;
      acc.eventos.push(...normalizeArray(alteracoesDoc.eventos));
      acc.variaveis.push(...normalizeArray(alteracoesDoc.variaveis));
      return acc;
    },
    { comparativo: {}, eventos: [], variaveis: [] }
  );
  const jornadasFallback = jornadasDocs.flatMap((doc: any) =>
    Array.isArray(doc?.funcionarios)
      ? doc.funcionarios.map((func: any) => ({
          funcionario: func?.nome || func?.funcionario || func?.colaborador || '-',
          cargo: func?.cargo || '',
          diasTrabalhados: func?.diasTrabalhados ?? func?.dias ?? 0,
          horasTrabalhadas: func?.horasTrabalhadas || func?.horas || func?.totalHoras || '',
          horasExtras: func?.horasExtras || func?.extras || '',
          atrasos: func?.atrasos || '',
          faltas: func?.faltas || '',
          observacoes: func?.observacoes || ''
        }))
      : []
  );
  const jornadas = jornadasBase.length > 0 ? jornadasBase : jornadasFallback;
  const metodoJornada =
    normalizeString(controleJornada.metodo) ||
    normalizeString(jornadasDocs.find((doc: any) => doc?.metodo)?.metodo) ||
    '-';
  const metodoJornadaDisplay = metodoJornada.replace(/cartao/gi, 'cartão');
  const eventosResolved =
    normalizeArray(eventosDP.ferias).length ||
    normalizeArray(eventosDP.desligamentos).length ||
    normalizeArray(eventosDP.admissoes).length ||
    normalizeArray(eventosDP.afastamentos).length
      ? eventosDP
      : eventosFromDocs;
  const alteracoesResolved =
    normalizeArray(alteracoesMes.eventos).length ||
    normalizeArray(alteracoesMes.variaveis).length ||
    alteracoesMes?.comparativo?.mesAnterior ||
    alteracoesMes?.comparativo?.mesAtual ||
    alteracoesMes?.comparativo?.variacaoPercentual
      ? alteracoesMes
      : alteracoesFromDocs;
  const alteracoesEventos = normalizeArray(alteracoesResolved.eventos);
  const alteracoesVariaveis = normalizeArray(alteracoesResolved.variaveis);
  const ferias = normalizeArray(eventosResolved.ferias);
  const desligamentos = normalizeArray(eventosResolved.desligamentos);
  const admissoes = normalizeArray(eventosResolved.admissoes);
  const afastamentos = normalizeArray(eventosResolved.afastamentos);
  const consignadoContratos = normalizeArray(consignado.contratos);
  const pontos = normalizeArray(pontosAtencao.itens);
  const pendencias = normalizeArray(avisosPendencias.itens);
  const pendenciasUnicas = normalizeUniqueTextList([...pendencias, ...pendenciasJornada]);
  const anexosDocs = normalizeArray(anexos.documentos);
  const uploadsDocs = normalizeArray(analisePrevia.uploads)
    .map((item: any) => item?.documentoNome || item?.nome || item?.fileName || item?.file_name)
    .filter(Boolean);
  const anexosListaFallback =
    anexosDocs.length > 0 ? anexosDocs : uploadsDocs.map((nome: string) => ({ nome }));
  const clienteNome = pickName(
    dadosCabecalho.clienteNome || dadosCabecalho.razaoSocial,
    relatorio.clientes_pj.razao_social
  );
  const clienteCnpj = pickCnpj(
    dadosCabecalho.clienteCnpj || dadosCabecalho.cnpj,
    relatorio.clientes_pj.cnpj
  );
  const competencia = normalizeString(dadosCabecalho.competencia) || relatorio.competencia || '-';
  const periodoApuracao = normalizeString(dadosCabecalho.periodoApuracao) || '-';
  const dataEmissao =
    normalizeString(dadosCabecalho.dataEmissao) ||
    relatorio.gerado_em ||
    relatorio.created_at ||
    '-';
  const jornadasParsed = jornadas.map((item: any) => {
    const horasTrabalhadas = parseDurationToMinutes(item?.horasTrabalhadas);
    const horasExtras = parseDurationToMinutes(item?.horasExtras);
    const salarioBaseMensal = parseBrNumber(item?.salarioBaseMensal);
    const valorHoraBase = parseBrNumber(item?.valorHoraBase);
    const valorHoraExtra = parseBrNumber(item?.valorHoraExtra);
    let vencimentoHoraExtra = parseBrNumber(item?.vencimentoHoraExtra);
    if (!vencimentoHoraExtra && valorHoraExtra > 0 && horasExtras > 0) {
      vencimentoHoraExtra = (horasExtras / 60) * valorHoraExtra;
    }
    return {
      funcionario: item?.funcionario || item?.nome || '-',
      horasTrabalhadas,
      horasExtras,
      salarioBaseMensal,
      valorHoraBase,
      valorHoraExtra,
      vencimentoHoraExtra,
      atrasos: item?.atrasos || '',
      faltas: item?.faltas || '',
      diasTrabalhados: item?.diasTrabalhados ?? 0
    };
  });
  const maxJornadaMinutes = jornadasParsed.reduce(
    (max: number, item: any) => Math.max(max, item.horasTrabalhadas + item.horasExtras),
    0
  );
  const pagamentosTotal = pagamentos.reduce((sum: number, item: any) => sum + parseBrNumber(item?.valor), 0);
  const pagamentosCount = pagamentos.length;
  const pagamentosAnaliseIA = normalizeString(valoresPagamento?.analiseIA);
  const pagamentosConferenciaIRRF = normalizeString(valoresPagamento?.conferenciaIRRF);
  const pagamentosConferenciaIRRFBases = normalizeString(valoresPagamento?.conferenciaIRRFBases);
  const conferenciaHorasExtras = normalizeString(controleJornada.conferenciaHorasExtras);
  const conferenciaHorasExtrasDetalhes = normalizeArray(controleJornada.conferenciaHorasExtrasDetalhes);
  const jornadaResumo = controleJornada.resumo || {};
  const jornadaHorasTrabalhadas =
    normalizeString(jornadaResumo.totalHorasTrabalhadas) ||
    formatMinutes(jornadasParsed.reduce((sum, item) => sum + item.horasTrabalhadas, 0));
  const jornadaHorasExtras =
    normalizeString(jornadaResumo.totalHorasExtras) ||
    formatMinutes(jornadasParsed.reduce((sum, item) => sum + item.horasExtras, 0));
  const jornadaFuncionarios =
    Number(jornadaResumo.totalFuncionarios) || jornadasParsed.length || 0;
  const eventosCount =
    ferias.length + desligamentos.length + admissoes.length + afastamentos.length;
  const pendenciasCount = pendenciasUnicas.length;
  const atencaoCount = pontos.length;
  const anexosCount = anexosListaFallback.length;

  return (
    <Tabs defaultValue="resumo" className="w-full">
      <TabsList className="w-full flex-wrap h-auto gap-1 p-1">
        <TabsTrigger value="resumo" className="flex items-center gap-1">
          <FileText className="h-4 w-4" />
          Resumo
        </TabsTrigger>
        <TabsTrigger value="pagamentos" className="flex items-center gap-1">
          <Wallet className="h-4 w-4" />
          Pagamentos
        </TabsTrigger>
        <TabsTrigger value="jornada" className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          Jornada
        </TabsTrigger>
        <TabsTrigger value="alteracoes" className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          Alterações
        </TabsTrigger>
        <TabsTrigger value="eventos" className="flex items-center gap-1">
          <Users className="h-4 w-4" />
          Eventos
        </TabsTrigger>
        <TabsTrigger value="consignado" className="flex items-center gap-1">
          <Wallet className="h-4 w-4" />
          Consignado
        </TabsTrigger>
        <TabsTrigger value="atencao" className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4" />
          Atenção
        </TabsTrigger>
        <TabsTrigger value="pendencias" className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4" />
          Pendências
        </TabsTrigger>
        <TabsTrigger value="anexos" className="flex items-center gap-1">
          <Paperclip className="h-4 w-4" />
          Anexos
        </TabsTrigger>
        {showComentarioTab && (
          <TabsTrigger value="comentario" className="flex items-center gap-1">
            <MessageSquareText className="h-4 w-4" />
            Comentário
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="resumo" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Informações Gerais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Cliente</p>
              <p className="font-medium">{clienteNome}</p>
            </div>
            <div>
              <p className="text-muted-foreground">CNPJ</p>
              <p className="font-medium">{clienteCnpj}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Competência</p>
              <p className="font-medium">{competencia}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Período de Apuração</p>
              <p className="font-medium">{periodoApuracao}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Data de Emissão</p>
              <p className="font-medium">{dataEmissao}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Indicadores do Parecer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Pagamentos</p>
              <p className="font-medium">{pagamentosCount ? `${pagamentosCount} itens` : '-'}</p>
              <p className="text-xs text-muted-foreground">
                Total: {pagamentosCount ? formatCurrency(pagamentosTotal) : '-'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Jornada</p>
              <p className="font-medium">
                {jornadaFuncionarios ? `${jornadaFuncionarios} funcionário(s)` : '-'}
              </p>
              <p className="text-xs text-muted-foreground">
                Horas: {jornadaHorasTrabalhadas || '-'} · Extras: {jornadaHorasExtras || '-'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Eventos</p>
              <p className="font-medium">{eventosCount ? `${eventosCount} registros` : '-'}</p>
              <p className="text-xs text-muted-foreground">
                Férias: {ferias.length || 0} · Admissões: {admissoes.length || 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Atenção</p>
              <p className="font-medium">{atencaoCount ? `${atencaoCount} ponto(s)` : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pendências</p>
              <p className="font-medium">{pendenciasCount ? `${pendenciasCount} item(ns)` : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Anexos</p>
              <p className="font-medium">{anexosCount ? `${anexosCount} arquivo(s)` : '-'}</p>
            </div>
          </CardContent>
        </Card>

        {comentarios?.agente && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comentário do Agente</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground whitespace-pre-line">
              {comentarios.agente}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="pagamentos" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Valores para Pagamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pagamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem valores informados.</p>
            ) : (
              pagamentos.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border p-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{item?.descricao || item?.documento || `Documento ${index + 1}`}</p>
                    {item?.fonte && <p className="text-xs text-muted-foreground">Fonte: {item.fonte}</p>}
                  </div>
                  <div className="text-sm text-right">
                    <div className="font-semibold">{item?.valor || '-'}</div>
                    {(item?.vencimento || item?.dataPagamento || item?.data) && (
                      <div className="text-xs text-muted-foreground">
                        Vencimento: {item?.vencimento || item?.dataPagamento || item?.data}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {pagamentosConferenciaIRRF && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {pagamentosConferenciaIRRF}
              </div>
            )}
            {pagamentosConferenciaIRRFBases && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {pagamentosConferenciaIRRFBases}
              </div>
            )}
            {pagamentosAnaliseIA && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {pagamentosAnaliseIA}
              </div>
            )}
            {folhas.length > 0 && (
              <div className="space-y-2">
                {folhas.map((folha: any, index: number) => (
                  <div key={index} className="rounded-lg border border-dashed p-3">
                    <p className="text-sm font-medium">
                      {folha?.documentoNome || folha?.periodo || `Folha ${index + 1}`}
                    </p>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        <span className="text-foreground">Salário bruto: </span>
                        {formatCurrency(folha?.totalSalarioBruto)}
                      </div>
                      <div>
                        <span className="text-foreground">INSS: </span>
                        {formatCurrency(folha?.totalINSS)}
                      </div>
                      <div>
                        <span className="text-foreground">FGTS: </span>
                        {formatCurrency(folha?.totalFGTS)}
                      </div>
                      <div>
                        <span className="text-foreground">Custo total: </span>
                        {formatCurrency(folha?.totalCustoFolha)}
                      </div>
                      <div>
                        <span className="text-foreground">Total líquido: </span>
                        {formatCurrency(folha?.totalLiquido)}
                      </div>
                      <div>
                        <span className="text-foreground">Funcionários: </span>
                        {folha?.quantidadeFuncionarios ?? '-'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {valoresPagamento?.observacoes && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {valoresPagamento.observacoes}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="jornada" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Controle de Jornada</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Método</p>
              <p className="font-medium">{metodoJornadaDisplay}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Jornada por Funcionário</p>
              {jornadasParsed.length === 0 ? (
                <p className="text-muted-foreground mt-1">Sem jornadas informadas.</p>
              ) : (
                <div className="mt-2 space-y-3">
                  {jornadasParsed.map((item: any, index: number) => {
                    const totalMinutes = item.horasTrabalhadas + item.horasExtras;
                    const destaqueMinutes = item.horasTrabalhadas || totalMinutes;
                    const width = maxJornadaMinutes > 0 ? Math.round((totalMinutes / maxJornadaMinutes) * 100) : 0;
                    const workedWidth = totalMinutes > 0 ? Math.round((item.horasTrabalhadas / totalMinutes) * 100) : 0;
                    return (
                      <div key={index} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium">{item.funcionario || `Funcionário ${index + 1}`}</span>
                          <span className="text-muted-foreground">{formatMinutes(destaqueMinutes)}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-foreground"
                            style={{ width: `${width}%` }}
                          >
                            <div className="h-full bg-primary" style={{ width: `${workedWidth}%` }} />
                          </div>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
                          <span>Horas: {formatMinutes(item.horasTrabalhadas)}</span>
                          <span>Extras: {formatMinutes(item.horasExtras)}</span>
                          <span>Dias: {item.diasTrabalhados || '-'}</span>
                          <span>
                            Venc. base: {item.salarioBaseMensal ? formatCurrency(item.salarioBaseMensal) : '-'}
                          </span>
                          <span>
                            Venc. extra:{' '}
                            {item.vencimentoHoraExtra ? formatCurrency(item.vencimentoHoraExtra) : '-'}
                          </span>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                          <span>
                            Hora padrão: {item.valorHoraBase ? formatCurrency(item.valorHoraBase) : '-'}
                          </span>
                          <span>
                            Hora extra: {item.valorHoraExtra ? formatCurrency(item.valorHoraExtra) : '-'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Pendências</p>
              <div className="mt-1 space-y-1">
                {pendenciasJornada.length === 0 ? (
                  <p className="text-muted-foreground">Sem pendências informadas.</p>
                ) : (
                  pendenciasJornada.map((doc: unknown, index: number) => (
                    <p key={index} className="text-sm">{renderItemText(doc)}</p>
                  ))
                )}
              </div>
            </div>
            {conferenciaHorasExtras && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {conferenciaHorasExtras}
              </div>
            )}
            {conferenciaHorasExtrasDetalhes.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                {conferenciaHorasExtrasDetalhes.map((item: unknown, index: number) => (
                  <p key={index}>{renderItemText(item)}</p>
                ))}
              </div>
            )}
            {controleJornada.alertas && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {controleJornada.alertas}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="alteracoes" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Alterações do Mês</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Mês Anterior</p>
                <p className="font-medium">{alteracoesResolved?.comparativo?.mesAnterior || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mês Atual</p>
                <p className="font-medium">{alteracoesResolved?.comparativo?.mesAtual || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Variação</p>
                <p className="font-medium">{alteracoesResolved?.comparativo?.variacaoPercentual || '-'}</p>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Eventos</p>
              <div className="mt-1 space-y-1">
                {alteracoesEventos.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum evento informado.</p>
                ) : (
                  alteracoesEventos.map((item: unknown, index: number) => (
                    <p key={index} className="text-sm">{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Variáveis</p>
              <div className="mt-1 space-y-1">
                {alteracoesVariaveis.length === 0 ? (
                  <p className="text-muted-foreground">Sem variáveis informadas.</p>
                ) : (
                  alteracoesVariaveis.map((item: unknown, index: number) => (
                    <p key={index} className="text-sm">{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
            {alteracoesResolved?.observacoes && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {alteracoesResolved.observacoes}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="eventos" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Eventos do Departamento Pessoal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Férias</p>
              <div className="mt-1 space-y-1">
                {ferias.length === 0 ? (
                  <p className="text-muted-foreground">Sem registros.</p>
                ) : (
                  ferias.map((item: unknown, index: number) => (
                    <p key={index}>{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Desligamentos</p>
              <div className="mt-1 space-y-1">
                {desligamentos.length === 0 ? (
                  <p className="text-muted-foreground">Sem registros.</p>
                ) : (
                  desligamentos.map((item: unknown, index: number) => (
                    <p key={index}>{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Admissões</p>
              <div className="mt-1 space-y-1">
                {admissoes.length === 0 ? (
                  <p className="text-muted-foreground">Sem registros.</p>
                ) : (
                  admissoes.map((item: unknown, index: number) => (
                    <p key={index}>{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Afastamentos</p>
              <div className="mt-1 space-y-1">
                {afastamentos.length === 0 ? (
                  <p className="text-muted-foreground">Sem registros.</p>
                ) : (
                  afastamentos.map((item: unknown, index: number) => (
                    <p key={index}>{renderItemText(item)}</p>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="consignado" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Consignado / FGTS Digital</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {consignado?.temConsignado ? 'Há consignado informado.' : 'Sem consignado informado.'}
            </p>
            {consignadoContratos.length > 0 && (
              <div className="space-y-1">
                {consignadoContratos.map((item: unknown, index: number) => (
                  <p key={index}>{renderItemText(item)}</p>
                ))}
              </div>
            )}
            {consignado?.observacoes && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {consignado.observacoes}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="atencao" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pontos de Atenção</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pontos.length === 0 ? (
              <p className="text-muted-foreground">Nenhum ponto de atenção informado.</p>
            ) : (
              pontos.map((item: unknown, index: number) => (
                <p key={index}>{renderItemText(item)}</p>
              ))
            )}
            {pontosAtencao?.observacoes && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {pontosAtencao.observacoes}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pendencias" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Avisos e Pendências</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pendencias.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma pendência registrada.</p>
            ) : (
              pendencias.map((item: unknown, index: number) => (
                <p key={index}>{renderItemText(item)}</p>
              ))
            )}
            {avisosPendencias?.observacoes && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {avisosPendencias.observacoes}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="anexos" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Anexos Recebidos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {anexosListaFallback.length === 0 ? (
              <p className="text-muted-foreground">Nenhum anexo listado.</p>
            ) : (
              anexosListaFallback.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border p-3">
                  <p className="font-medium">{item?.nome || `Documento ${index + 1}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {item?.tipo || item?.mimeType || ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {showComentarioTab && (
        <TabsContent value="comentario" className="mt-4">
          {comentarioContent}
        </TabsContent>
      )}
    </Tabs>
  );
}
