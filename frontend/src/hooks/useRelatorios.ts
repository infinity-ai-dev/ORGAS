import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ApiError, apiFetch } from '@/lib/api';

export type RelatorioStatus = 'rascunho' | 'pendente_aprovacao' | 'aprovado' | 'rejeitado';

export interface RelatorioFiscal {
  type?: string | null;
  relatorio_type?: string | null;
  id: string;
  cliente_id: string;
  competencia: string;
  ano: number;
  mes: number;
  receita_bruta_mes: number;
  receita_bruta_12_meses: number;
  total_notas_emitidas: number;
  total_notas_recebidas: number;
  valor_notas_emitidas: number;
  valor_notas_recebidas: number;
  simples_anexo: string | null;
  simples_aliquota_efetiva: number;
  simples_valor_devido: number;
  simples_deducao: number;
  simples_irpj: number;
  simples_csll: number;
  simples_cofins: number;
  simples_pis: number;
  simples_cpp: number;
  simples_icms: number;
  simples_iss: number;
  presumido_base_irpj: number;
  presumido_irpj: number;
  presumido_csll: number;
  presumido_pis: number;
  presumido_cofins: number;
  presumido_iss: number;
  presumido_total: number;
  folha_total_bruto: number;
  folha_encargos: number;
  guias_federais: number;
  guias_estaduais: number;
  guias_municipais: number;
  status: RelatorioStatus;
  aprovado_por: string | null;
  aprovado_em: string | null;
  observacoes: string | null;
  documentos_processados: number;
  gerado_em: string;
  modelo_ia: string | null;
  tipo_relatorio: string | null;
  tipo_parecer: string | null;
  regime_tributario_selecionado: string | null;
  created_at: string;
  updated_at: string;
  // Extended fields
  anexo_efetivo: string | null;
  fator_r: number | null;
  rbt12_calculado: number | null;
  total_impostos_retidos: number | null;
  economia_vs_presumido: number | null;
  total_compras: number | null;
  // JSONB sections
  secao1_faturamento: Record<string, unknown> | null;
  secao2_financeiro: Record<string, unknown> | null;
  secao3_documentos: Record<string, unknown> | null;
  secao4_tabela_mensal: Array<Record<string, unknown>> | null;
  secao5_acompanham: Array<Record<string, unknown>> | null;
  secao6_analisados: Array<Record<string, unknown>> | null;
  secao7_tributaria: Record<string, unknown> | null;
  secao8_assinatura: Record<string, unknown> | null;
  secao9_analista: Record<string, unknown> | null;
  alertas: Array<Record<string, unknown>> | null;
  secoes_json?: Record<string, unknown> | null;
  arquivo_url?: string | null;
  arquivo_nome?: string | null;
}

export interface RelatorioWithCliente extends RelatorioFiscal {
  clientes_pj: {
    razao_social: string;
    cnpj: string;
    regime_tributario: string | null;
    anexo_simples: string | null;
  };
}

function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value)
    .replace(/R\$\s?/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace('%', '')
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value: any): number {
  const num = parseNumber(value);
  if (num > 1) return num / 100;
  return num;
}

function sumDetalhamentoTributo(detalhamento: any, matcher: RegExp): number {
  if (!Array.isArray(detalhamento)) return 0;

  return detalhamento.reduce((sum, item) => {
    const tributo = String(item?.tributo || item?.nome || '').trim();
    if (!matcher.test(tributo)) return sum;
    return sum + parseNumber(item?.valor ?? item?.valor_formatado ?? item?.valorFormatado);
  }, 0);
}

function parseCompetencia(competencia: string | null | undefined) {
  if (!competencia) return { ano: 0, mes: 0 };
  const [mes, ano] = competencia.split('/');
  return { mes: Number(mes) || 0, ano: Number(ano) || 0 };
}

function normalizeSecoes(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function normalizeTipoParecer(value: any): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;

  const tipoMap: Record<string, string> = {
    tax: 'fiscal',
    fiscal: 'fiscal',
    personal: 'pessoal',
    pessoal: 'pessoal',
    accounting: 'contabil',
    contabil: 'contabil',
    support: 'atendimento',
    atendimento: 'atendimento',
    generic: 'generico',
    generico: 'generico',
  };

  return tipoMap[normalized] || normalized;
}

function normalizeAlertas(alertas: any): Array<Record<string, unknown>> {
  if (!Array.isArray(alertas)) return [];

  return alertas
    .map((item: any) => {
      if (!item) return null;

      if (typeof item === 'string') {
        return {
          tipo: 'Fiscal',
          mensagem: item,
          nivel: 'ALERTA',
        };
      }

      const nivelRaw = String(item.nivel || item.level || '').trim().toUpperCase();
      const nivel =
        nivelRaw === 'CRITICO' || nivelRaw === 'OK' || nivelRaw === 'INFO'
          ? nivelRaw
          : 'ALERTA';

      return {
        tipo: String(item.tipo || item.category || 'Fiscal'),
        mensagem: String(item.mensagem || item.message || ''),
        nivel,
        detalhes: item.detalhes || item.details || undefined,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

function buildStructuredApprovalRow(row: any) {
  const responseData = normalizeSecoes(row.response_data);
  const responseCabecalho = responseData?.dadosCabecalho || {};
  const structuredSecoes =
    responseData &&
    typeof responseData === 'object' &&
    !Array.isArray(responseData) &&
    (
      responseData?.dadosCabecalho ||
      responseData?.tipo === 'PARECER_PESSOAL' ||
      responseData?.dadosSecao1 ||
      responseData?.dadosSecao2
    )
      ? responseData
      : null;

  if (!structuredSecoes) return null;

  const competencia =
    row.competencia ||
    responseData?.competencia ||
    responseCabecalho?.competencia ||
    responseCabecalho?.periodoApuracao ||
    responseCabecalho?.periodo ||
    responseData?.periodo ||
    responseData?.receita_bruta?.periodo ||
    responseData?.fiscal_data?.competencia ||
    responseData?.fiscal_data?.periodo ||
    '';

  const clienteNome =
    row.cliente_nome ||
    responseData?.cliente_nome ||
    responseData?.clientName ||
    responseCabecalho?.clienteNome ||
    responseCabecalho?.razaoSocial ||
    responseCabecalho?.razao_social ||
    responseData?.razao_social ||
    responseData?.razaoSocial ||
    'Cliente';

  const clienteCnpj =
    responseData?.cliente_cnpj ||
    responseCabecalho?.clienteCnpj ||
    responseCabecalho?.cnpj ||
    row.cnpj_matriz ||
    row.cnpjmatrizabreviado ||
    '';

  const geradoEm =
    row.data_geracao ||
    row.data_aprovacao ||
    row.data_rejeicao ||
    row.created_at ||
    new Date().toISOString();

  return {
    ...row,
    id: String(row.relatorio_original_id ?? row.relatorio_id ?? row.id ?? ''),
    cliente_id: String(row.cliente_id || responseData?.cliente_id || ''),
    cliente_nome: clienteNome,
    tipo_parecer: normalizeTipoParecer(
      row.tipo_parecer ||
      row.type ||
      responseData?.tipo_parecer ||
      responseData?.tipoParecer ||
      responseData?.agent
    ),
    competencia,
    cnpj_matriz: String(clienteCnpj || ''),
    cnpjmatrizabreviado: String(clienteCnpj || ''),
    user_name: clienteNome,
    date_time: geradoEm,
    created_at: geradoEm,
    updated_at: row.updated_at || geradoEm,
    analista_nome: row.aprovado_por || null,
    secoes_json: structuredSecoes,
    response_data: responseData,
  };
}

function mapApprovalRelatorioFromBackend(row: any, statusOverride?: RelatorioStatus): RelatorioWithCliente {
  const structuredRow = buildStructuredApprovalRow(row);
  if (structuredRow) {
    return mapRelatorioFromBackend(structuredRow, statusOverride);
  }

  const responseData = normalizeSecoes(row.response_data);
  const responseCabecalho = responseData?.dadosCabecalho || {};
  const competencia =
    row.competencia ||
    responseData?.competencia ||
    responseCabecalho?.competencia ||
    responseCabecalho?.periodoApuracao ||
    responseCabecalho?.periodo ||
    responseData?.periodo ||
    responseData?.receita_bruta?.periodo ||
    responseData?.fiscal_data?.competencia ||
    responseData?.fiscal_data?.periodo ||
    '';
  const { ano, mes } = parseCompetencia(competencia);
  const tipoParecer = normalizeTipoParecer(
    row.tipo_parecer ||
    row.type ||
    responseData?.tipo_parecer ||
    responseData?.tipoParecer ||
    responseData?.agent
  );
  const clienteNome =
    row.cliente_nome ||
    responseData?.cliente_nome ||
    responseData?.clientName ||
    responseCabecalho?.clienteNome ||
    responseCabecalho?.razaoSocial ||
    responseCabecalho?.razao_social ||
    responseData?.razao_social ||
    responseData?.razaoSocial ||
    'Cliente';
  const clienteCnpj =
    responseData?.cliente_cnpj ||
    responseCabecalho?.clienteCnpj ||
    responseCabecalho?.cnpj ||
    row.cnpj_matriz ||
    row.cnpjmatrizabreviado ||
    '';
  const status =
    statusOverride ||
    (row.status_aprovacao === 'aprovado'
      ? 'aprovado'
      : row.status_aprovacao === 'reprovado'
        ? 'rejeitado'
        : 'pendente_aprovacao');
  const geradoEm =
    row.data_geracao ||
    row.data_aprovacao ||
    row.data_rejeicao ||
    row.created_at ||
    new Date().toISOString();
  const receitaBrutaMes = parseNumber(
    responseData?.receita_bruta?.valor ??
    responseData?.receita_bruta ??
    responseData?.fiscal_data?.receita_bruta?.valor ??
    responseData?.fiscal_data?.receita_bruta ??
    responseData?.fiscal_data?.receita_bruta_mes ??
    responseData?.fiscal_data?.receitaBrutaMes
  );
  const impostoDevido = parseNumber(
    responseData?.impostos?.devido ??
    responseData?.imposto_devido ??
    responseData?.fiscal_data?.simples_valor_devido ??
    responseData?.fiscal_data?.imposto_devido ??
    responseData?.fiscal_data?.impostoDevido
  );
  const resolvedId = row.relatorio_original_id ?? row.relatorio_id ?? row.id;

  return {
    id: String(resolvedId ?? ''),
    cliente_id: String(row.cliente_id || ''),
    competencia,
    ano,
    mes,
    receita_bruta_mes: receitaBrutaMes,
    receita_bruta_12_meses: 0,
    total_notas_emitidas: 0,
    total_notas_recebidas: 0,
    valor_notas_emitidas: 0,
    valor_notas_recebidas: 0,
    simples_anexo: null,
    simples_aliquota_efetiva: 0,
    simples_valor_devido: impostoDevido,
    simples_deducao: 0,
    simples_irpj: 0,
    simples_csll: 0,
    simples_cofins: 0,
    simples_pis: 0,
    simples_cpp: 0,
    simples_icms: 0,
    simples_iss: 0,
    presumido_base_irpj: 0,
    presumido_irpj: 0,
    presumido_csll: 0,
    presumido_pis: 0,
    presumido_cofins: 0,
    presumido_iss: 0,
    presumido_total: 0,
    folha_total_bruto: 0,
    folha_encargos: 0,
    guias_federais: 0,
    guias_estaduais: 0,
    guias_municipais: 0,
    status,
    aprovado_por: row.aprovado_por || null,
    aprovado_em: row.data_aprovacao || null,
    observacoes: row.justificativa || null,
    documentos_processados: Number(row.documentos_analisados || 0),
    gerado_em: geradoEm,
    modelo_ia: null,
    tipo_relatorio: row.relatorio_type || row.tipo_parecer || null,
    tipo_parecer: tipoParecer,
    regime_tributario_selecionado: null,
    created_at: geradoEm,
    updated_at: row.updated_at || geradoEm,
    anexo_efetivo: null,
    fator_r: null,
    rbt12_calculado: 0,
    total_impostos_retidos: null,
    economia_vs_presumido: null,
    total_compras: null,
    secao1_faturamento: null,
    secao2_financeiro: null,
    secao3_documentos: null,
    secao4_tabela_mensal: null,
    secao5_acompanham: null,
    secao6_analisados: null,
    secao7_tributaria: null,
    secao8_assinatura: null,
    secao9_analista: null,
    alertas: normalizeAlertas(responseData?.alertas),
    secoes_json: responseData,
    arquivo_url: row.arquivo_url ?? null,
    arquivo_nome: row.arquivo_nome ?? null,
    type: row.type ?? tipoParecer,
    relatorio_type: row.relatorio_type ?? row.tipo_parecer ?? null,
    clientes_pj: {
      razao_social: clienteNome,
      cnpj: String(clienteCnpj || ''),
      regime_tributario: responseCabecalho?.regimeTributario || null,
      anexo_simples: null
    },
    ...(responseData ? { response_data: responseData } : {})
  } as RelatorioWithCliente;
}

function mapRelatorioFromBackend(row: any, statusOverride?: RelatorioStatus): RelatorioWithCliente {
  if (row.response_data && !row.secoes_json) {
    return mapApprovalRelatorioFromBackend(row, statusOverride);
  }

  const secoesJson = normalizeSecoes(row.secoes_json);
  const dadosCabecalho = secoesJson.dadosCabecalho || {};
  const dadosSecao1 = secoesJson.dadosSecao1 || {};
  const dadosSecao2 = secoesJson.dadosSecao2 || {};
  const dadosSecao3 = secoesJson.dadosSecao3 || {};
  const dadosSecao4 = secoesJson.dadosSecao4 || {};
  const dadosSecao5 = secoesJson.dadosSecao5 || {};
  const dadosSecao6 = secoesJson.dadosSecao6 || {};
  const dadosSecao7 = secoesJson.dadosSecao7 || {};
  const dadosSecao8 = secoesJson.dadosSecao8 || {};
  const dadosSecao9 = secoesJson.dadosSecao9 || {};
  const fiscalData = secoesJson.fiscal_data || {};
  const impostosPayload = secoesJson.impostos || {};
  const impostosDetalhamento = Array.isArray(impostosPayload?.detalhamento)
    ? impostosPayload.detalhamento
    : [];
  const documentosFiscais = dadosSecao3?.documentosFiscais || {};
  const documentosFiscaisLista = Object.values(documentosFiscais).filter(
    (item) => item && typeof item === 'object'
  ) as Array<Record<string, unknown>>;

  const competencia =
    row.competencia ||
    dadosCabecalho.competencia ||
    dadosCabecalho.periodoApuracao ||
    dadosCabecalho.periodo ||
    fiscalData.competencia ||
    fiscalData.periodo ||
    '';
  const { ano, mes } = parseCompetencia(competencia);
  const tipoParecer = normalizeTipoParecer(
    row.type ||
    row.tipo_parecer ||
    dadosCabecalho.tipo_parecer ||
    dadosCabecalho.tipoParecer ||
    secoesJson.tipoParecer ||
    secoesJson.tipo_parecer ||
    secoesJson.agent
  );
  const relatorioType =
    dadosCabecalho.relatorio_type ||
    row.relatorio_type ||
    row.categoria ||
    null;

  const receitaBrutaMes = parseNumber(
    dadosSecao1?.faturamento?.valor ??
    dadosSecao1?.faturamento?.valorFormatado ??
    secoesJson?.receita_bruta?.valor ??
    secoesJson?.receita_bruta?.formatado ??
    fiscalData?.receita_bruta_mes ??
    fiscalData?.receita_bruta?.valor
  );
  const receita12 = parseNumber(
    dadosSecao7?.receitaBruta12Meses?.valor ??
    dadosSecao7?.receitaBruta12Meses?.valorFormatado ??
    dadosSecao6?.rbt12 ??
    fiscalData?.rbt12
  );
  const simplesAliquota = parsePercent(
    dadosSecao1?.imposto?.aliquotaEfetiva ??
    dadosSecao1?.imposto?.aliquotaEfetivaFormatada ??
    dadosSecao7?.simplesNacionalAnexoIII?.aliquota ??
    dadosSecao7?.simplesNacionalAnexoIII?.aliquotaFormatada ??
    dadosSecao7?.simplesAnexoIII?.aliquota
  );
  const simplesValor = parseNumber(
    dadosSecao1?.imposto?.impostoPagar ??
    dadosSecao1?.imposto?.impostoPagarFormatado ??
    dadosSecao1?.imposto?.valor ??
    dadosSecao1?.imposto?.valorFormatado ??
    fiscalData?.simples_valor_devido ??
    fiscalData?.imposto_devido
  );

  const lucropresumido = dadosSecao7?.lucroPresumido || {};
  const detalhamentoLP = lucropresumido?.detalhamento || {};
  const simplesAnexoIII = dadosSecao7?.simplesNacionalAnexoIII || dadosSecao7?.simplesAnexoIII || {};
  const simplesAnexoV = dadosSecao7?.simplesNacionalAnexoV || dadosSecao7?.simplesAnexoV || {};
  const simplesIrpj = sumDetalhamentoTributo(impostosDetalhamento, /\birpj\b/i);
  const simplesCsll = sumDetalhamentoTributo(impostosDetalhamento, /\bcsll\b/i);
  const simplesCofins = sumDetalhamentoTributo(impostosDetalhamento, /\bcofins\b/i);
  const simplesPis = sumDetalhamentoTributo(impostosDetalhamento, /\bpis\b/i);
  const simplesCpp = sumDetalhamentoTributo(impostosDetalhamento, /\b(inss|cpp)\b/i);
  const simplesIss = sumDetalhamentoTributo(impostosDetalhamento, /\biss\b/i);
  const totalNotasEmitidas = documentosFiscaisLista.reduce(
    (sum, item: any) => sum + parseNumber(item?.quantidade),
    0
  );
  const valorNotasEmitidas = documentosFiscaisLista.reduce(
    (sum, item: any) =>
      sum + parseNumber(item?.valorTotalFormatado ?? item?.valorFormatado ?? item?.valorTotal ?? item?.valor),
    0
  );
  const totalNotasCanceladas = documentosFiscaisLista.reduce(
    (sum, item: any) => sum + parseNumber(item?.quantidadeCanceladas ?? item?.canceladas),
    0
  );
  const valorNotasCanceladas = parseNumber(
    dadosSecao3?.valorNotasCanceladas ??
    fiscalData?.receita_cancelada
  );
  const totalRetido = parseNumber(
    dadosSecao1?.imposto?.totalRetido ??
    dadosSecao1?.imposto?.totalRetidoFormatado
  );
  const fatorR = (() => {
    const directValue = dadosSecao7?.fatorR?.valor;
    if (directValue !== null && directValue !== undefined && directValue !== '') {
      const parsed = Number(directValue);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = parsePercent(
      dadosSecao7?.fatorR?.valorFormatado ??
      dadosSecao4?.indicadores?.fatorR ??
      dadosSecao6?.fatorR ??
      fiscalData?.fator_r
    );
    return parsed || null;
  })();
  const folhaTotalBruto = parseNumber(
    dadosSecao4?.totais?.folhaDetalhe?.valor ??
    dadosSecao4?.totais?.folhaDetalhe?.valorFormatado ??
    dadosSecao4?.totais?.folha?.valor ??
    dadosSecao4?.totais?.folha ??
    fiscalData?.folha_competencia
  );
  const folhaEncargos = parseNumber(fiscalData?.inss_folha);
  const impostoPago = parseNumber(
    secoesJson?.impostos?.pago ??
    fiscalData?.imposto_pago
  );

  const secao1EstabelecimentosRaw = Array.isArray(dadosSecao1?.estabelecimentos) ? dadosSecao1.estabelecimentos : [];
  const secao1Estabelecimentos = secao1EstabelecimentosRaw.map((est: any) => {
    const descricao = String(est.descricao || '').toUpperCase();
    const tipo = descricao.includes('MATRIZ') ? 'MATRIZ' : 'FILIAL';
    return {
      tipo,
      cnpj: est.cnpj || '',
      receita: parseNumber(est.receita),
      aliquota: parsePercent(est.aliquota),
      imposto: parseNumber(est.imposto)
    };
  });

  const secao1_faturamento = {
    estabelecimentos: secao1Estabelecimentos,
    aliquotaNominal: parsePercent(
      dadosSecao1?.imposto?.aliquotaFinal ??
      dadosSecao1?.imposto?.aliquotaFinalFormatada ??
      dadosSecao1?.imposto?.aliquotaEfetiva ??
      dadosSecao1?.imposto?.aliquotaEfetivaFormatada
    ),
  };

  const secao2_financeiro = {
    vendasCartao: [],
    totalCartao: parseNumber(dadosSecao2?.movimento?.vendasCartao?.valor),
    pixRecebidos: parseNumber(dadosSecao2?.movimento?.pix?.valor),
    qtdPix: parseNumber(dadosSecao2?.movimento?.pix?.quantidade),
    transferenciasRecebidas: parseNumber(dadosSecao2?.movimento?.transferencias?.valor),
    transferenciasMesmaTitularidade: 0,
    totalMovimento: parseNumber(dadosSecao2?.movimento?.total?.valor),
    divergencia: parsePercent(dadosSecao2?.divergencia?.porcentagem),
  };

  const secao3_documentos = {
    impostos_retidos: {
      iss: parseNumber(dadosSecao1?.imposto?.retencoes?.iss),
      irrf: parseNumber(dadosSecao1?.imposto?.retencoes?.irrf),
      pis: parseNumber(dadosSecao1?.imposto?.retencoes?.pis),
      cofins: parseNumber(dadosSecao1?.imposto?.retencoes?.cofins),
      csll: 0,
      inss: 0
    },
    totalNotasCanceladas,
    valorNotasCanceladas,
    documentosFiscais: dadosSecao3?.documentosFiscais || {},
    notasDuplicadas: dadosSecao3?.notasDuplicadas || {}
  };

  const secao4_tabela_mensal = Array.isArray(dadosSecao4?.meses)
    ? dadosSecao4.meses.map((item: any) => ({
        mes: item.mes,
        receita: parseNumber(item.faturamento?.valor),
        imposto: parseNumber(item.impostos?.valor),
        folha: parseNumber(item.folha?.valor),
        compras: parseNumber(item.compras?.valor),
        lucro: parseNumber(item.lucro?.valor)
      }))
    : [];

  const secao5_acompanham = Array.isArray(dadosSecao5?.documentos) ? dadosSecao5.documentos : [];
  const secao6_analisados = Array.isArray(dadosSecao6?.documentos) ? dadosSecao6.documentos : [];

  const documentosProcessados = dadosSecao6?.resumo?.analisados
    ? parseNumber(dadosSecao6.resumo.analisados)
    : Array.isArray(secoesJson?.analise_previa?.documentos)
      ? secoesJson.analise_previa.documentos.length
      : 0;

  const statusFromJson = secoesJson?.status_relatorio as RelatorioStatus | undefined;
  const status = statusOverride || statusFromJson || 'pendente_aprovacao';

  const clienteNome =
    dadosCabecalho.cliente_nome ||
    dadosCabecalho.clienteNome ||
    dadosCabecalho.razaoSocial ||
    dadosCabecalho.razao_social ||
    row.user_name ||
    'Cliente';

  const clienteCnpj =
    dadosCabecalho.cliente_cnpj ||
    dadosCabecalho.cnpj ||
    row.cnpj_matriz ||
    row.cnpjmatrizabreviado ||
    '';

  const clienteRegime = dadosCabecalho.cliente_regime_tributario || dadosCabecalho.regimeTributario || null;

  const resolvedId = row.id ?? row.relatorio_id ?? row.relatorioId ?? row.relatorio_id;
  return {
    id: String(resolvedId ?? ''),
    cliente_id: String(dadosCabecalho.cliente_id || row.cliente_id || ''),
    competencia,
    ano,
    mes,
    receita_bruta_mes: receitaBrutaMes,
    receita_bruta_12_meses: receita12,
    total_notas_emitidas: totalNotasEmitidas,
    total_notas_recebidas: 0,
    valor_notas_emitidas: valorNotasEmitidas,
    valor_notas_recebidas: 0,
    simples_anexo: dadosSecao1?.anexo || simplesAnexoIII?.anexo || fiscalData?.simples_anexo || null,
    simples_aliquota_efetiva: simplesAliquota,
    simples_valor_devido: simplesValor,
    simples_deducao: 0,
    simples_irpj: simplesIrpj,
    simples_csll: simplesCsll,
    simples_cofins: simplesCofins,
    simples_pis: simplesPis,
    simples_cpp: simplesCpp,
    simples_icms: 0,
    simples_iss: simplesIss,
    presumido_base_irpj: parseNumber(detalhamentoLP?.lucroPresumido?.valor),
    presumido_irpj: parseNumber(detalhamentoLP?.irpj?.valor),
    presumido_csll: parseNumber(detalhamentoLP?.csll?.valor),
    presumido_pis: parseNumber(detalhamentoLP?.pis?.valor),
    presumido_cofins: parseNumber(detalhamentoLP?.cofins?.valor),
    presumido_iss: parseNumber(detalhamentoLP?.iss?.valor),
    presumido_total: parseNumber(lucropresumido?.imposto),
    folha_total_bruto: folhaTotalBruto,
    folha_encargos: folhaEncargos,
    guias_federais: impostoPago,
    guias_estaduais: 0,
    guias_municipais: 0,
    status,
    aprovado_por: row.analista_nome || null,
    aprovado_em: row.created_at || row.date_time || null,
    observacoes: secoesJson?.observacoes || null,
    documentos_processados: documentosProcessados,
    gerado_em: row.date_time || row.created_at || new Date().toISOString(),
    modelo_ia: null,
    tipo_relatorio: relatorioType,
    tipo_parecer: tipoParecer,
    regime_tributario_selecionado: dadosSecao7?.analise?.regimeMaisVantajoso || null,
    created_at: row.date_time || row.created_at || new Date().toISOString(),
    updated_at: row.date_time || row.updated_at || new Date().toISOString(),
    anexo_efetivo: dadosSecao1?.anexo || simplesAnexoIII?.anexo || fiscalData?.simples_anexo || null,
    fator_r: fatorR,
    rbt12_calculado: receita12,
    total_impostos_retidos: totalRetido,
    economia_vs_presumido: parseNumber(
      lucropresumido?.diferencaSimples ??
      dadosSecao7?.analise?.economia
    ),
    total_compras: parseNumber(dadosSecao4?.totais?.compras?.valor ?? dadosSecao4?.totais?.compras),
    secao1_faturamento,
    secao2_financeiro,
    secao3_documentos,
    secao4_tabela_mensal,
    secao5_acompanham,
    secao6_analisados,
    secao7_tributaria: dadosSecao7 || null,
    secao8_assinatura: dadosSecao8 || null,
    secao9_analista: dadosSecao9 || null,
    alertas: normalizeAlertas(secoesJson?.alertas ?? dadosSecao4?.alertas ?? row.response_data?.alertas),
    secoes_json: secoesJson || null,
    arquivo_url: row.arquivo_url ?? null,
    arquivo_nome: row.arquivo_nome ?? null,
    type: row.type ?? null,
    relatorio_type: row.relatorio_type ?? relatorioType,
    clientes_pj: {
      razao_social: clienteNome,
      cnpj: clienteCnpj,
      regime_tributario: clienteRegime,
      anexo_simples: dadosSecao1?.anexo || null
    }
  };
}

export function useRelatorios(clienteId?: string, ano?: number) {
  return useQuery({
    queryKey: ['relatorios', clienteId, ano],
    queryFn: async () => {
      const [approvedResult, pendingResult, rejectedResult] = await Promise.allSettled([
        apiFetch<any[]>('/relatorios', { method: 'GET' }),
        apiFetch<{ success: boolean; count: number; data: any[] }>('/relatorios/approval/pendentes', { method: 'GET' }),
        apiFetch<{ success: boolean; count: number; data: any[] }>('/relatorios/approval/reprovados', { method: 'GET' }),
      ]);

      const approved = approvedResult.status === 'fulfilled'
        ? approvedResult.value.map((row) => mapRelatorioFromBackend(row, 'aprovado'))
        : [];
      const pending = pendingResult.status === 'fulfilled'
        ? (pendingResult.value.data || []).map((row) => mapRelatorioFromBackend(row, 'pendente_aprovacao'))
        : [];
      const rejected = rejectedResult.status === 'fulfilled'
        ? (rejectedResult.value.data || []).map((row) => mapRelatorioFromBackend(row, 'rejeitado'))
        : [];

      let results = [...pending, ...approved, ...rejected].sort((a, b) => {
        const aTime = new Date(a.gerado_em || a.created_at || 0).getTime();
        const bTime = new Date(b.gerado_em || b.created_at || 0).getTime();
        return bTime - aTime;
      });

      if (clienteId) {
        results = results.filter((r) => r.cliente_id === clienteId);
      }
      if (ano) {
        results = results.filter((r) => r.ano === ano);
      }
      return results as RelatorioWithCliente[];
    },
  });
}

export function useRelatorio(id: string | undefined) {
  return useQuery({
    queryKey: ['relatorio', id],
    queryFn: async () => {
      if (!id) return null;
      try {
        const approvedRelatorios = await apiFetch<any[]>('/relatorios', { method: 'GET' });
        const relatorio = approvedRelatorios.find((r: any) => {
          const candidates = [
            r?.id,
            r?.relatorio_id,
            r?.relatorioId,
            r?.relatorio_original_id,
            r?.relatorioOriginalId,
          ]
            .filter((value: unknown) => value !== null && value !== undefined)
            .map((value: unknown) => String(value));

          return candidates.includes(String(id));
        });
        if (relatorio) {
          return mapRelatorioFromBackend(relatorio, 'aprovado');
        }
      } catch {
        // If approved list fails, try approval endpoint
      }

      try {
        const approvalResponse = await apiFetch<{ success: boolean; data: any }>(`/relatorios/approval/${id}/detalhes`, { method: 'GET' });
        const approval = approvalResponse?.data;
        if (!approval) return null;
        return mapRelatorioFromBackend(
          approval,
          approval.status_aprovacao === 'aprovado'
            ? 'aprovado'
            : approval.status_aprovacao === 'reprovado'
              ? 'rejeitado'
              : 'pendente_aprovacao'
        );
      } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          throw error;
        }

        console.error(`Failed to load relatório ${id}:`, error);
        throw error instanceof Error ? error : new Error('Erro ao carregar relatório');
      }
    },
    enabled: !!id,
  });
}

export function useGerarRelatorio() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      throw new Error('Use o Gerador para enviar documentos e criar um relatório.');
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Ação não disponível',
        description: error.message,
      });
    },
  });
}

export function useAtualizarStatusRelatorio() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      observacoes,
    }: {
      id: string;
      status: RelatorioStatus;
      observacoes?: string;
      aprovadoPor?: string;
    }) => {
      if (status === 'aprovado') {
        await apiFetch(`/relatorios/${id}/aprovar`, {
          method: 'POST',
          body: { observacoes }
        });
        return null;
      }

      await apiFetch(`/relatorios/${id}/status`, {
        method: 'POST',
        body: { status, observacoes }
      });
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relatorios'] });
      toast({
        title: 'Status atualizado',
        description: 'O status do relatório foi atualizado.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar status',
        description: error.message,
      });
    },
  });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0,00%';
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
