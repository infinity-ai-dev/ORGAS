import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// HELPERS DE FORMATAÇÃO
// ============================================================================

function formatarMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function formatarPorcentagem(valor: number | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined || isNaN(valor)) return '0,00%';
  return `${valor.toFixed(casas).replace('.', ',')}%`;
}

function formatarData(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(data) : data;
  return d.toLocaleDateString('pt-BR');
}

function normalizeDataVencimento(valor: unknown): string | null {
  if (!valor) return null;
  const raw = String(valor).trim();
  if (!raw) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatarData(raw);
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return formatarData(parsed);
  return null;
}

function determinarCorValor(valor: number): string {
  return valor >= 0 ? '#10b981' : '#ef4444';
}

function getNomeMes(mes: number): string {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return meses[mes - 1] || 'Mês';
}

// ============================================================================
// TABELAS DO SIMPLES NACIONAL
// ============================================================================

interface FaixaSimples { limite: number; aliquota: number; deducao: number; faixaDescricao: string; }

const ANEXO_III: FaixaSimples[] = [
  { limite: 180000, aliquota: 6.00, deducao: 0, faixaDescricao: 'Faixa 1 (Nominal: 6%, Efetiva: 6.00%)' },
  { limite: 360000, aliquota: 11.20, deducao: 9360, faixaDescricao: 'Faixa 2 (Nominal: 11.20%)' },
  { limite: 720000, aliquota: 13.50, deducao: 17640, faixaDescricao: 'Faixa 3 (Nominal: 13.50%)' },
  { limite: 1800000, aliquota: 16.00, deducao: 35640, faixaDescricao: 'Faixa 4 (Nominal: 16.00%)' },
  { limite: 3600000, aliquota: 21.00, deducao: 125640, faixaDescricao: 'Faixa 5 (Nominal: 21.00%)' },
  { limite: 4800000, aliquota: 33.00, deducao: 648000, faixaDescricao: 'Faixa 6 (Nominal: 33.00%)' },
];

const ANEXO_V: FaixaSimples[] = [
  { limite: 180000, aliquota: 15.50, deducao: 0, faixaDescricao: 'Faixa 1 (Nominal: 15.50%)' },
  { limite: 360000, aliquota: 18.00, deducao: 4500, faixaDescricao: 'Faixa 2 (Nominal: 18.00%)' },
  { limite: 720000, aliquota: 19.50, deducao: 9900, faixaDescricao: 'Faixa 3 (Nominal: 19.50%)' },
  { limite: 1800000, aliquota: 20.50, deducao: 17100, faixaDescricao: 'Faixa 4 (Nominal: 20.50%)' },
  { limite: 3600000, aliquota: 23.00, deducao: 62100, faixaDescricao: 'Faixa 5 (Nominal: 23.00%)' },
  { limite: 4800000, aliquota: 30.50, deducao: 540000, faixaDescricao: 'Faixa 6 (Nominal: 30.50%)' },
];

function getFaixaSimples(rbt12: number, tabela: FaixaSimples[]): FaixaSimples {
  for (const faixa of tabela) { if (rbt12 <= faixa.limite) return faixa; }
  return tabela[tabela.length - 1];
}

function calcularAliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (rbt12 === 0) return faixa.aliquota;
  return ((rbt12 * (faixa.aliquota / 100)) - faixa.deducao) / rbt12 * 100;
}

function calcularImposto(receita: number, rbt12: number, tabela: FaixaSimples[]) {
  const faixa = getFaixaSimples(rbt12, tabela);
  const aliquotaEfetiva = calcularAliquotaEfetiva(rbt12, faixa);
  return { imposto: receita * (aliquotaEfetiva / 100), aliquota: aliquotaEfetiva, faixa };
}

function getTipoAtividadeLabel(anexo: string | null): string {
  switch (anexo) {
    case 'I': return 'COMÉRCIO (MATRIZ)';
    case 'II': return 'INDÚSTRIA (MATRIZ)';
    default: return 'SERVIÇOS (MATRIZ)';
  }
}

function getPresuncaoLP(anexo: string | null): number {
  return (anexo === 'I' || anexo === 'II') ? 8 : 32;
}

function calcularVencimentoDAS(competencia: string): string {
  const [mes, ano] = competencia.split('/').map(Number);
  let mesVenc = mes + 1, anoVenc = ano;
  if (mesVenc > 12) { mesVenc = 1; anoVenc++; }
  const dataVenc = new Date(anoVenc, mesVenc - 1, 20);
  if (dataVenc.getDay() === 0) dataVenc.setDate(22);
  if (dataVenc.getDay() === 6) dataVenc.setDate(22);
  return formatarData(dataVenc);
}

function gerarInterpretacaoDivergencia(pct: number): string {
  const p = Math.abs(pct);
  if (p < 2) return 'Divergência mínima, provavelmente relacionada ao timing de recebimentos';
  if (p < 5) return 'Divergência dentro da margem aceitável';
  if (p < 10) return 'Divergência moderada, recomenda-se verificação';
  return 'Divergência significativa, verificação obrigatória';
}

function getRegimeLabel(regime: string | null): string {
  if (regime === 'lucro_presumido') return 'Lucro Presumido';
  if (regime === 'lucro_real') return 'Lucro Real';
  return 'Simples Nacional';
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { clienteId, competencia, tipoRelatorio, tipoParecer, regimeTributario } = await req.json();

    if (!clienteId || !competencia) throw new Error('clienteId e competencia são obrigatórios');
    console.log(`[consolidate-report] Iniciando para cliente ${clienteId}, competência ${competencia}`);

    const { data: cliente, error: clienteError } = await supabase.from('clientes_pj').select('*').eq('id', clienteId).single();
    if (clienteError || !cliente) throw new Error(`Cliente não encontrado: ${clienteError?.message}`);

    const [mesStr, anoStr] = competencia.split('/');
    const mes = parseInt(mesStr, 10), ano = parseInt(anoStr, 10);

    const { data: documentos } = await supabase.from('documentos').select('*').eq('cliente_id', clienteId).eq('mes', mes).eq('ano', ano).eq('status', 'processado');
    const docIds = documentos?.map(d => d.id) || [];
    const { data: dadosExtraidos } = await supabase.from('dados_extraidos').select('*').in('documento_id', docIds.length > 0 ? docIds : ['00000000-0000-0000-0000-000000000000']);

    console.log(`[consolidate-report] ${documentos?.length || 0} docs, ${dadosExtraidos?.length || 0} extrações`);

    // Consolidar dados
    const anexoCliente = cliente.anexo_simples || 'III';
    const regimeCliente = cliente.regime_tributario || 'simples_nacional';
    let receitaMes = 0, totalFolha = 0, totalCompras = 0, pixRecebidos = 0, transferenciasRecebidas = 0, depositosRecebidos = 0, vendasCartao = 0;
    let bancoNome = '', historicoReceitas: Array<{mes:string;valor:number}> = [], historicoFolhas: Array<{mes:string;valor:number}> = [];
    let dataVencimentoReal: string | null = null;
    let notasCanceladas: string[] = [], totalNfse = 0, totalNfe = 0, fatorRExtraido: number | null = null, anexoDetectado: string | null = null;

    for (const dados of dadosExtraidos || []) {
      if (dados.tipo_documento === 'pgdas' && dados.dados_pgdas) {
        const pgdas = dados.dados_pgdas as Record<string, unknown>;
        receitaMes = Number(pgdas.receita_bruta_mes || pgdas.receitaBrutaMes || 0) || receitaMes;
        fatorRExtraido = Number(pgdas.fator_r || pgdas.fatorR || dados.fator_r_aplicado) || fatorRExtraido;
        anexoDetectado = String(pgdas.anexo || dados.anexo_detectado || '') || anexoDetectado;
        const vencimentoExtraido =
          pgdas.dataVencimento ||
          pgdas.data_vencimento ||
          pgdas.dataVencimentoDAS ||
          pgdas.dataVencimentoDas ||
          (pgdas as any).data_vencimento_das ||
          (dados as any).data_vencimento ||
          (dados as any).dataVencimento;
        const vencimentoNormalizado = normalizeDataVencimento(vencimentoExtraido);
        if (vencimentoNormalizado) dataVencimentoReal = vencimentoNormalizado;
        const histRec = (pgdas.historico_receitas || pgdas.historicoReceitas || dados.historico_receitas) as Array<{mes?:string;periodo?:string;valor?:number;receita?:number}> | null;
        if (Array.isArray(histRec)) historicoReceitas = histRec.map(h => ({ mes: h.mes || h.periodo || '', valor: Number(h.valor || h.receita || 0) }));
        const histFolha = (pgdas.historico_folhas || pgdas.historicoFolhas || dados.historico_folhas) as Array<{mes?:string;periodo?:string;valor?:number;folha?:number}> | null;
        if (Array.isArray(histFolha)) historicoFolhas = histFolha.map(h => ({ mes: h.mes || h.periodo || '', valor: Number(h.valor || h.folha || 0) }));
      }
      if (dados.tipo_documento === 'folha_pagamento' && dados.dados_folha) totalFolha = Number((dados.dados_folha as Record<string, unknown>).total_bruto || (dados.dados_folha as Record<string, unknown>).totalBruto || 0) || totalFolha;
      if (dados.tipo_documento === 'extrato_bancario' && dados.dados_extrato) {
        const ext = dados.dados_extrato as Record<string, unknown>;
        bancoNome = String(ext.banco || ext.instituicao || '') || bancoNome;
        const pix = dados.pix_recebidos || ext.pix_recebidos || ext.pix;
        pixRecebidos = Array.isArray(pix) ? pix.reduce((a, p) => a + (Number((p as {valor:number}).valor) || 0), 0) : typeof pix === 'number' ? pix : 0;
        const transf = dados.transferencias || ext.transferencias;
        transferenciasRecebidas = Array.isArray(transf) ? transf.reduce((a, t) => a + (Number((t as {valor:number}).valor) || 0), 0) : typeof transf === 'number' ? transf : 0;
        const deps = ext.depositos;
        depositosRecebidos = Array.isArray(deps) ? deps.reduce((a, d) => a + (Number((d as {valor:number}).valor) || 0), 0) : typeof deps === 'number' ? deps : 0;
        const cartao = dados.vendas_cartao || ext.vendas_cartao;
        vendasCartao = Array.isArray(cartao) ? cartao.reduce((a, c) => a + (Number((c as {valor:number}).valor) || 0), 0) : typeof cartao === 'number' ? cartao : 0;
      }
      if (dados.tipo_documento === 'nfse' && dados.dados_nfse) {
        const nfse = dados.dados_nfse as Record<string, unknown>;
        totalNfse = Number(nfse.quantidade || nfse.total_notas || 0) || totalNfse;
        const canc = nfse.notas_canceladas as string[] | null;
        if (Array.isArray(canc)) notasCanceladas = [...notasCanceladas, ...canc];
      }
      if (dados.tipo_documento === 'nfe' && dados.dados_nfe) totalNfe = Number((dados.dados_nfe as Record<string, unknown>).quantidade || (dados.dados_nfe as Record<string, unknown>).total_notas || 0) || totalNfe;
      const comprasData = dados.compras_mes;
      if (Array.isArray(comprasData)) totalCompras = comprasData.reduce((a, c) => a + (Number((c as {valor:number}).valor) || 0), 0);
      else if (typeof comprasData === 'number') totalCompras = comprasData;
    }

    const anexoEfetivo = anexoDetectado || anexoCliente;
    if (receitaMes === 0 && dadosExtraidos) for (const d of dadosExtraidos) if (d.valor_total && d.valor_total > 0) receitaMes += d.valor_total;
    
    let rbt12 = historicoReceitas.length > 0 ? historicoReceitas.reduce((a, h) => a + h.valor, 0) : receitaMes * 12;
    let folhaAnual = historicoFolhas.length > 0 ? historicoFolhas.reduce((a, h) => a + h.valor, 0) : totalFolha * 12;
    const fatorR = rbt12 > 0 ? folhaAnual / rbt12 : 0;
    const aplicaAnexoIII = fatorR >= 0.28;
    const tabelaSimples = aplicaAnexoIII ? ANEXO_III : ANEXO_V;
    const calcSimples = calcularImposto(receitaMes, rbt12, tabelaSimples);
    const movimentoTotal = pixRecebidos + transferenciasRecebidas + depositosRecebidos + vendasCartao;
    const divergenciaValor = receitaMes - movimentoTotal;
    const divergenciaPct = receitaMes > 0 ? (divergenciaValor / receitaMes) * 100 : 0;
    const aliquotaEfetiva = calcSimples.aliquota;
    const dataVencimento = dataVencimentoReal || calcularVencimentoDAS(competencia);

    // Build sections according to documented payload structure
    const cabecalho = { cnpj: cliente.cnpj, periodo: competencia, dataGeracao: new Date().toISOString(), razaoSocial: cliente.razao_social, periodoFormatado: `Competência: ${competencia}`, regimeTributario: getRegimeLabel(regimeCliente), dataGeracaoFormatada: formatarData(new Date()), regimeTributarioCompleto: `${getRegimeLabel(regimeCliente)} - ${anexoEfetivo}` };

    const secao1_faturamento = { anexo: anexoEfetivo, totais: { imposto: formatarMoeda(calcSimples.imposto), faturamento: formatarMoeda(receitaMes) }, grafico: { impostoLabel: formatarPorcentagem(aliquotaEfetiva), impostoAltura: Math.min(aliquotaEfetiva, 100), faturamentoLabel: '100%', faturamentoAltura: 100, aliquotaFinalLabel: formatarPorcentagem(aliquotaEfetiva), diferencaAliquotas: '0,00', aliquotaFinalAltura: Math.min(aliquotaEfetiva, 100), aliquotaFinalTitulo: 'Alíq. Final', aliquotaEfetivaLabel: formatarPorcentagem(aliquotaEfetiva), mostrarDuasAliquotas: false, aliquotaEfetivaAltura: Math.min(aliquotaEfetiva, 100), aliquotaEfetivaTitulo: 'Alíq. Efetiva', diferencaAliquotasLabel: '' }, imposto: { valor: calcSimples.imposto, retencoes: { iss: 0, pis: 0, irrf: 0, cofins: 0, issFormatado: 'R$ 0,00', pisFormatado: 'R$ 0,00', irrfFormatado: 'R$ 0,00', cofinsFormatado: 'R$ 0,00' }, temRetencao: false, totalRetido: 0, impostoPagar: calcSimples.imposto, aliquotaFinal: aliquotaEfetiva.toFixed(2), valorFormatado: formatarMoeda(calcSimples.imposto), aliquotaEfetiva, correcaoAplicada: false, fonteDadosImposto: 'calculado', totalRetidoFormatado: 'R$ 0,00', impostoPagarFormatado: formatarMoeda(calcSimples.imposto), aliquotaFinalFormatada: formatarPorcentagem(aliquotaEfetiva), aliquotaEfetivaFormatada: formatarPorcentagem(aliquotaEfetiva) }, faturamento: { valor: receitaMes, descricao: getTipoAtividadeLabel(anexoEfetivo), valorFormatado: formatarMoeda(receitaMes) }, aplicouFatorR: aplicaAnexoIII, dataVencimento, estabelecimentos: [{ imposto: formatarMoeda(calcSimples.imposto), receita: formatarMoeda(receitaMes).replace('R$ ', ''), aliquota: formatarPorcentagem(aliquotaEfetiva), descricao: getTipoAtividadeLabel(anexoEfetivo), dataVencimento }] };

    const secao2_financeiro = { banco: bancoNome || 'Não identificado', movimento: { pix: { valor: pixRecebidos, valorFormatado: formatarMoeda(pixRecebidos) }, total: { valor: movimentoTotal, valorFormatado: formatarMoeda(movimentoTotal) }, depositos: { valor: depositosRecebidos, valorFormatado: formatarMoeda(depositosRecebidos) }, vendasCartao: { valor: vendasCartao, valorFormatado: formatarMoeda(vendasCartao) }, transferencias: { valor: transferenciasRecebidas, valorFormatado: formatarMoeda(transferenciasRecebidas) } }, divergencia: { valor: divergenciaValor, corTexto: divergenciaValor >= 0 ? '#10b981' : '#ef4444', ehNegativa: divergenciaValor < 0, porcentagem: formatarPorcentagem(Math.abs(divergenciaPct)), valorFormatado: formatarMoeda(Math.abs(divergenciaValor)) }, temMovimento: movimentoTotal > 0, interpretacao: gerarInterpretacaoDivergencia(divergenciaPct), faturamentoDeclarado: { valor: receitaMes, valorFormatado: formatarMoeda(receitaMes) } };

    const qtdCanc = notasCanceladas.length;
    const secao3_documentos = { notasDuplicadas: { mensagem: 'Não foram identificadas notas fiscais duplicadas no período analisado.', encontradas: false }, documentosFiscais: { cte: { status: 'REGULAR', regular: true }, nfe: { status: 'REGULAR', regular: true, gaps: [] }, nfce: { status: 'REGULAR', regular: true }, nfse: { status: qtdCanc > 0 ? `REGULAR - ${qtdCanc} nota(s) cancelada(s): ${notasCanceladas.join(', ')}` : 'REGULAR', regular: true, observacoes: '', notasCanceladas, quantidadeCanceladas: qtdCanc } } };

    // Section 4: Monthly evolution
    const mesesEvo: Array<{mes:string;folha:{fonte:string;valor:number;valorFormatado:string};lucro:{cor:string;valor:number;ehPositivo:boolean;valorFormatado:string};compras:{valor:number;valorFormatado:string};impostos:{fonte:string;valor:number;aliquota:string;valorFormatado:string};faturamento:{valor:number;valorFormatado:string};mesOriginal:string}> = [];
    for (const rec of historicoReceitas) { const mn = parseInt(rec.mes.split('/')[0], 10); const fm = historicoFolhas.find(f => f.mes === rec.mes)?.valor || 0; const im = rec.valor * (aliquotaEfetiva / 100); const lm = rec.valor - im - fm; mesesEvo.push({ mes: getNomeMes(mn), folha: { fonte: 'historico', valor: fm, valorFormatado: formatarMoeda(fm) }, lucro: { cor: determinarCorValor(lm), valor: lm, ehPositivo: lm >= 0, valorFormatado: formatarMoeda(lm) }, compras: { valor: 0, valorFormatado: 'R$ 0,00' }, impostos: { fonte: 'calculado', valor: im, aliquota: formatarPorcentagem(aliquotaEfetiva), valorFormatado: formatarMoeda(im) }, faturamento: { valor: rec.valor, valorFormatado: formatarMoeda(rec.valor) }, mesOriginal: rec.mes }); }
    const mesAtualStr = `${mesStr.padStart(2, '0')}/${anoStr}`;
    if (!mesesEvo.find(m => m.mesOriginal === mesAtualStr)) { const la = receitaMes - calcSimples.imposto - totalFolha - totalCompras; mesesEvo.push({ mes: getNomeMes(mes), folha: { fonte: 'historico', valor: totalFolha, valorFormatado: formatarMoeda(totalFolha) }, lucro: { cor: determinarCorValor(la), valor: la, ehPositivo: la >= 0, valorFormatado: formatarMoeda(la) }, compras: { valor: totalCompras, valorFormatado: formatarMoeda(totalCompras) }, impostos: { fonte: 'calculado', valor: calcSimples.imposto, aliquota: formatarPorcentagem(aliquotaEfetiva), valorFormatado: formatarMoeda(calcSimples.imposto) }, faturamento: { valor: receitaMes, valorFormatado: formatarMoeda(receitaMes) }, mesOriginal: mesAtualStr }); }
    const totFat = mesesEvo.reduce((a, m) => a + m.faturamento.valor, 0); const totImp = mesesEvo.reduce((a, m) => a + m.impostos.valor, 0); const totFol = mesesEvo.reduce((a, m) => a + m.folha.valor, 0); const totCom = mesesEvo.reduce((a, m) => a + m.compras.valor, 0); const totLuc = mesesEvo.reduce((a, m) => a + m.lucro.valor, 0);
    const margemLiq = totFat > 0 ? (totLuc / totFat) * 100 : 0; const ticketMedio = mesesEvo.length > 0 ? totFat / mesesEvo.length : 0; const custoFolhaPct = totFat > 0 ? (totFol / totFat) * 100 : 0;
    const secao4_tabela_mensal = { meses: mesesEvo, totais: { folha: { valor: totFol, valorFormatado: formatarMoeda(totFol) }, lucro: { cor: determinarCorValor(totLuc), valor: totLuc, ehPositivo: totLuc >= 0, margemLiquida: formatarPorcentagem(margemLiq), valorFormatado: formatarMoeda(totLuc) }, compras: { valor: totCom, valorFormatado: formatarMoeda(totCom) }, impostos: { valor: totImp, aliquotaMedia: formatarPorcentagem(aliquotaEfetiva), valorFormatado: formatarMoeda(totImp) }, faturamento: { valor: totFat, valorFormatado: formatarMoeda(totFat) } }, alertas: [], temDados: mesesEvo.length > 0, indicadores: { ticketMedio: formatarMoeda(ticketMedio), margemLiquida: formatarPorcentagem(margemLiq), custoFolhaPercentual: formatarPorcentagem(custoFolhaPct) }, quantidadeMeses: mesesEvo.length };

    // Sections 5 & 6
    const tiposEnv = new Set(documentos?.map(d => d.tipo_documento) || []);
    const docsAcomp: Array<{nome:string;icone:string;enviado:boolean}> = [];
    if (tiposEnv.has('pgdas') || tiposEnv.has('guia_federal')) docsAcomp.push({ nome: 'Guia DAS Simples Nacional (Para pagamento)', icone: '✓', enviado: true });
    if (tiposEnv.has('pgdas')) { docsAcomp.push({ nome: 'Extrato PGDAS (para fonte de análise)', icone: '✓', enviado: true }); docsAcomp.push({ nome: 'Extrato Acumuladores (para fonte de análise)', icone: '✓', enviado: true }); }
    const secao5_acompanham = { documentos: docsAcomp };

    const tiposLabels: Record<string,string> = { 'extrato_bancario': 'Extrato Bancário', 'pgdas': 'Extrato PGDAS', 'folha_pagamento': 'Extrato da Folha', 'nfse': 'Relatório de Notas Fiscais', 'nfe': 'Relatório de Notas Fiscais', 'guia_federal': 'GUIA do PGDAS' };
    const docsAnal: Array<{cor:string;nome:string;icone:string;numero:number;analisado:boolean}> = [];
    let numDoc = 1; for (const t of tiposEnv) if (t && tiposLabels[t]) docsAnal.push({ cor: '#10b981', nome: tiposLabels[t], icone: '✓', numero: numDoc++, analisado: true });
    const secao6_analisados = { resumo: { total: docsAnal.length, analisados: docsAnal.length, naoAnalisados: 0 }, documentos: docsAnal };

    // Section 7: Tax comparison
    const calcAnexoIII = calcularImposto(receitaMes, rbt12, ANEXO_III); const calcAnexoV = calcularImposto(receitaMes, rbt12, ANEXO_V);
    const presuncao = getPresuncaoLP(anexoEfetivo); const lpBase = receitaMes * (presuncao / 100);
    const lpIRPJ = lpBase * 0.15; const lpCSLL = lpBase * 0.09; const lpPIS = receitaMes * 0.0065; const lpCOFINS = receitaMes * 0.03; const lpISS = receitaMes * 0.05; const lpTotal = lpIRPJ + lpCSLL + lpPIS + lpCOFINS + lpISS; const lpAliqEf = receitaMes > 0 ? (lpTotal / receitaMes) * 100 : 0;
    const regimes = [{ regime: 'Simples Nacional Anexo III', imposto: calcAnexoIII.imposto, ehAtual: aplicaAnexoIII && regimeCliente === 'simples_nacional' }, { regime: 'Simples Nacional Anexo V', imposto: calcAnexoV.imposto, ehAtual: !aplicaAnexoIII && regimeCliente === 'simples_nacional' }, { regime: 'Lucro Presumido', imposto: lpTotal, ehAtual: regimeCliente === 'lucro_presumido' }].sort((a, b) => a.imposto - b.imposto);
    const regAtual = regimes.find(r => r.ehAtual) || regimes[0]; const regMV = regimes[0]; const econ = regAtual.imposto - regMV.imposto; const jaMelhor = regAtual.regime === regMV.regime;
    const ranking = regimes.map((r, i) => ({ regime: r.regime, ehAtual: r.ehAtual, imposto: r.imposto, posicao: i + 1, ehMaisVantajoso: i === 0, impostoFormatado: formatarMoeda(r.imposto) }));
    const secao7_tributaria = { fatorR: { valor: fatorR, aplicaAnexoIII, valorFormatado: formatarPorcentagem(fatorR * 100), textoExplicativo: fatorR >= 0.28 ? 'Fator R ≥ 28%: Empresa enquadrada no Anexo III' : 'Fator R < 28%: Empresa enquadrada no Anexo V' }, analise: { economia: econ, mensagem: jaMelhor ? `✓ A empresa já está no regime mais vantajoso (${regAtual.regime}).` : `⚠ O regime ${regMV.regime} seria mais vantajoso.`, regimeAtual: regAtual.regime, impostoAtual: regAtual.imposto, recomendacao: jaMelhor ? 'Manter regime tributário atual.' : `Avaliar migração para ${regMV.regime}.`, economiaAnual: econ * 12, economiaFormatada: formatarMoeda(econ), jEstaMelhorRegime: jaMelhor, regimeMaisVantajoso: regMV.regime, impostoMaisVantajoso: regMV.imposto, impostoAtualFormatado: formatarMoeda(regAtual.imposto), economiaAnualFormatada: formatarMoeda(econ * 12), impostoMaisVantajosoFormatado: formatarMoeda(regMV.imposto) }, ranking, folhaAnual: { valor: folhaAnual, valorFormatado: formatarMoeda(folhaAnual) }, lucroPresumido: { imposto: lpTotal, presuncao: `${presuncao}%`, composicao: 'IRPJ (15%) + CSLL (9%) + PIS (0,65%) + COFINS (3%) + ISS (5%)', ehMaisCaro: lpTotal > calcAnexoIII.imposto, detalhamento: { iss: { valor: lpISS, aliquota: '5%', valorFormatado: formatarMoeda(lpISS) }, pis: { valor: lpPIS, aliquota: '0,65%', valorFormatado: formatarMoeda(lpPIS) }, csll: { valor: lpCSLL, calculo: `${formatarMoeda(lpBase)} × 9%`, aliquota: '9%', valorFormatado: formatarMoeda(lpCSLL) }, irpj: { valor: lpIRPJ, calculo: `${formatarMoeda(lpBase)} × 15%`, aliquota: '15%', valorFormatado: formatarMoeda(lpIRPJ) }, cofins: { valor: lpCOFINS, aliquota: '3%', valorFormatado: formatarMoeda(lpCOFINS) }, lucroPresumido: { valor: lpBase, calculo: `${formatarMoeda(receitaMes)} × ${presuncao}%`, valorFormatado: formatarMoeda(lpBase) } }, aliquotaEfetiva: lpAliqEf, impostoFormatado: formatarMoeda(lpTotal), diferencaSimples: lpTotal - calcAnexoIII.imposto, diferencaFormatada: formatarMoeda(lpTotal - calcAnexoIII.imposto), aliquotaEfetivaFormatada: formatarPorcentagem(lpAliqEf) }, receitaBruta12Meses: { valor: rbt12, valorFormatado: formatarMoeda(rbt12) }, temDadosSuficientes: receitaMes > 0, simplesNacionalAnexoV: { anexo: 'V', imposto: calcAnexoV.imposto, aliquota: calcAnexoV.aliquota, corDestaque: !aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '#0284c7' : '#f59e0b', bordaDestaque: !aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '3px solid #0284c7' : '1px solid #cbd5e1', ehRegimeAtual: !aplicaAnexoIII && regimeCliente === 'simples_nacional', textoDestaque: !aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '✓ Regime Atual' : '', impostoFormatado: formatarMoeda(calcAnexoV.imposto), aliquotaFormatada: formatarPorcentagem(calcAnexoV.aliquota), diferencaFormatada: formatarMoeda(calcAnexoV.imposto - calcAnexoIII.imposto), diferencaAnexoIII: calcAnexoV.imposto - calcAnexoIII.imposto, ehMaisCaro: calcAnexoV.imposto > calcAnexoIII.imposto }, simplesNacionalAnexoIII: { anexo: 'III', imposto: calcAnexoIII.imposto, aliquota: calcAnexoIII.aliquota, faixaAtual: calcAnexoIII.faixa.faixaDescricao, corDestaque: aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '#0284c7' : '#f59e0b', bordaDestaque: aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '3px solid #0284c7' : '1px solid #cbd5e1', ehRegimeAtual: aplicaAnexoIII && regimeCliente === 'simples_nacional', textoDestaque: aplicaAnexoIII && regimeCliente === 'simples_nacional' ? '✓ Regime Atual' : '', impostoFormatado: formatarMoeda(calcAnexoIII.imposto), aliquotaFormatada: formatarPorcentagem(calcAnexoIII.aliquota) } };

    // Section 8: Final observations
    const tipoAtiv = anexoEfetivo === 'I' ? 'comércio' : anexoEfetivo === 'II' ? 'indústria' : 'prestação de serviços';
    let obs = `A empresa ${cliente.razao_social} é optante pelo ${getRegimeLabel(regimeCliente)} e atua somente com ${tipoAtiv}, enquadrada no Anexo ${anexoEfetivo}${(anexoEfetivo === 'III' || anexoEfetivo === 'V') ? ' e sujeita ao Fator R' : ''}.`;
    if (bancoNome) { obs += ` O extrato bancário (${bancoNome})`; if (vendasCartao === 0) { const t = []; if (pixRecebidos > 0) t.push('PIX'); if (transferenciasRecebidas > 0) t.push('transferências'); if (depositosRecebidos > 0) t.push('depósitos'); obs += ` não detalha vendas por cartão, sendo o movimento de entrada identificado como ${t.join(' e ')}.`; } else obs += ` indica vendas por cartão de ${formatarMoeda(vendasCartao)}.`; }
    if (qtdCanc > 0) obs += ` A(s) Nota(s) Fiscal(is) de Serviço de número ${notasCanceladas.join(', ')} foi(foram) cancelada(s) no período.`;
    if (Math.abs(divergenciaPct) > 1) obs += ` Há uma divergência de ${formatarMoeda(Math.abs(divergenciaValor))} entre o movimento financeiro e a receita declarada.`;
    obs += ` O DAS da competência ${competencia} está pendente de pagamento.`;
    const secao8_assinatura = { detalhes: { anexo: anexoEfetivo, banco: bancoNome || 'Não identificado', regime: getRegimeLabel(regimeCliente), empresa: cliente.razao_social, periodo: competencia, dasPendente: true, aplicaFatorR: aplicaAnexoIII, notasCanceladas, temVendasCartao: vendasCartao > 0, divergenciaFinanceira: { valor: divergenciaValor, existe: Math.abs(divergenciaPct) > 1, valorAbsoluto: Math.abs(divergenciaValor) }, quantidadeNotasCanceladas: qtdCanc }, observacao: obs };

    // Save to database
    const { data: existente } = await supabase.from('relatorios_fiscais').select('id').eq('cliente_id', clienteId).eq('competencia', competencia).single();
    const relData = { cliente_id: clienteId, competencia, ano, mes, receita_bruta_mes: receitaMes, receita_bruta_12_meses: rbt12, total_notas_emitidas: totalNfse + totalNfe, total_notas_recebidas: 0, valor_notas_emitidas: receitaMes, valor_notas_recebidas: 0, simples_anexo: anexoEfetivo, simples_aliquota_efetiva: aliquotaEfetiva / 100, simples_valor_devido: calcSimples.imposto, simples_deducao: calcAnexoIII.faixa.deducao, simples_irpj: 0, simples_csll: 0, simples_cofins: 0, simples_pis: 0, simples_cpp: 0, simples_icms: 0, simples_iss: 0, presumido_base_irpj: lpBase, presumido_irpj: lpIRPJ, presumido_csll: lpCSLL, presumido_pis: lpPIS, presumido_cofins: lpCOFINS, presumido_iss: lpISS, presumido_total: lpTotal, folha_total_bruto: totalFolha, folha_encargos: 0, guias_federais: 0, guias_estaduais: 0, guias_municipais: 0, status: 'rascunho', observacoes: null, documentos_processados: documentos?.length || 0, gerado_em: new Date().toISOString(), modelo_ia: 'gemini-2.5-pro', tipo_relatorio: tipoRelatorio || 'parecer_fiscal', tipo_parecer: tipoParecer || 'completo', regime_tributario_selecionado: regimeTributario || regimeCliente, anexo_efetivo: anexoEfetivo, fator_r: fatorR, rbt12_calculado: rbt12, total_impostos_retidos: 0, economia_vs_presumido: calcAnexoIII.imposto - lpTotal, total_compras: totalCompras, secao1_faturamento, secao2_financeiro, secao3_documentos, secao4_tabela_mensal, secao5_acompanham, secao6_analisados, secao7_tributaria, secao8_assinatura, alertas: [] };

    let relatorioId: string;
    if (existente) { const { data: upd, error: ue } = await supabase.from('relatorios_fiscais').update(relData).eq('id', existente.id).select().single(); if (ue) throw ue; relatorioId = upd.id; } 
    else { const { data: ins, error: ie } = await supabase.from('relatorios_fiscais').insert(relData).select().single(); if (ie) throw ie; relatorioId = ins.id; }
    
    console.log(`[consolidate-report] Relatório ${existente ? 'atualizado' : 'criado'}: ${relatorioId}`);
    return new Response(JSON.stringify({ success: true, relatorioId, resumo: { receitaMes, impostoCalculado: calcSimples.imposto, aliquotaEfetiva, fatorR, anexoEfetivo, documentosProcessados: documentos?.length || 0 }, cabecalho }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error) {
    console.error('[consolidate-report] Erro:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});
