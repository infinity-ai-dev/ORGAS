import { buildSecoesFromConsolidado } from '../../sections';
import { isCalcSchema } from './validators';
import type { WorkflowTypeConfig } from './config';
import {
  buildAgentContents,
  buildClassificationContents,
  buildClassificationPrompt,
  buildExtractionPrompt,
  routeAgent
} from './defaults';

const outputSchema = `{
  "tipo": "SECAO8",
  "dadosSecao1": { "anexo": "", "totais": { "imposto": "R$ 0,00", "faturamento": "R$ 0,00" }, "grafico": {}, "imposto": {}, "faturamento": {}, "aplicouFatorR": false, "dataVencimento": "", "estabelecimentos": [] },
  "dadosSecao2": { "banco": "", "movimento": {}, "divergencia": {}, "temMovimento": false, "interpretacao": "", "faturamentoDeclarado": {} },
  "dadosSecao3": { "notasDuplicadas": { "mensagem": "", "encontradas": false }, "documentosFiscais": { "nfse": {}, "nfe": {}, "nfce": {}, "cte": {} } },
  "dadosSecao4": { "meses": [], "totais": {}, "alertas": [], "temDados": false, "indicadores": {}, "quantidadeMeses": 0 },
  "dadosSecao5": { "documentos": [] },
  "dadosSecao6": { "resumo": { "total": 0, "analisados": 0, "naoAnalisados": 0 }, "documentos": [] },
  "dadosSecao7": { "fatorR": {}, "analise": {}, "ranking": [] },
  "dadosSecao8": {
    "detalhes": {},
    "observacao": "",
    "observacoes": "",
    "categoriaParecer": "",
    "entidades": { "nomes": [], "datas": [], "valores": [], "ativos": [] },
    "recomendacoes": [],
    "conformidade": { "status": "", "itens": [] },
    "validacao": { "erros": [], "avisos": [], "ok": true },
    "estrutura": { "cabecalho": "", "escopo": "", "analise": [], "conclusao": "" }
  },
  "dadosCabecalho": { "cnpj": "", "periodo": "", "razaoSocial": "", "regimeTributario": "", "dataGeracao": "", "dataGeracaoFormatada": "", "tipo_parecer": "" }
}`;

const sectionKeys = [
  'dadosCabecalho',
  'dadosSecao1',
  'dadosSecao2',
  'dadosSecao3',
  'dadosSecao4',
  'dadosSecao5',
  'dadosSecao6',
  'dadosSecao7',
  'dadosSecao8'
];

function buildPayload(state: any) {
  return { consolidated: state.consolidated };
}

function buildBaseFromConsolidado(state: any) {
  return buildSecoesFromConsolidado(state.consolidated) || {};
}

function buildFallback(state: any) {
  return buildCalcFallback(state.consolidated);
}

function buildCalcFallback(consolidated: any) {
  if (!consolidated) return null;

  const faturamentoDeclarado = parseValorLocal(
    consolidated?.secao1_FaturamentoImpostos?.faturamentoDeclarado ??
      consolidated?.secao5_LucroPrejuizo?.receitaBruta ??
      0
  );
  const totalMovimento = parseValorLocal(consolidated?.secao2_MovimentoFinanceiro?.totalMovimento ?? 0);
  const diferenca = Math.abs(faturamentoDeclarado - totalMovimento);
  const percentualDivergencia = faturamentoDeclarado
    ? Math.abs((diferenca / faturamentoDeclarado) * 100)
    : 0;

  const totalImpostos = parseValorLocal(
    consolidated?.secao1_FaturamentoImpostos?.impostoCalculado ??
      consolidated?.secao5_LucroPrejuizo?.impostos ??
      0
  );
  const totalFolha = parseValorLocal(
    consolidated?.secao4_FolhaPagamento?.totalCustoFolha ??
      consolidated?.secao5_LucroPrejuizo?.custoFolha ??
      0
  );
  const totalCompras = parseValorLocal(consolidated?.secao1_FaturamentoImpostos?.comprasMes ?? 0);

  const impostosRetidos = consolidated?.secao1_FaturamentoImpostos?.impostosRetidos;
  let impostoRetidoTotal = parseValorLocal(impostosRetidos?.total ?? 0);
  if (!impostoRetidoTotal && impostosRetidos) {
    impostoRetidoTotal =
      parseValorLocal(impostosRetidos?.iss) +
      parseValorLocal(impostosRetidos?.irrf) +
      parseValorLocal(impostosRetidos?.pis) +
      parseValorLocal(impostosRetidos?.cofins);
  }

  const lucroEstimado = (() => {
    const lucro = parseValorLocal(consolidated?.secao5_LucroPrejuizo?.lucroEstimado ?? 0);
    if (lucro !== 0) return lucro;
    return faturamentoDeclarado - totalImpostos - totalFolha;
  })();

  const statusDivergencia =
    consolidated?.secao2_MovimentoFinanceiro?.divergencia?.status ||
    computeStatusDivergencia(faturamentoDeclarado, diferenca);

  return {
    faturamentoDeclarado: {
      valor: faturamentoDeclarado,
      formatado: formatValorLocal(faturamentoDeclarado)
    },
    totalMovimento: {
      valor: totalMovimento,
      formatado: formatValorLocal(totalMovimento)
    },
    diferenca: {
      valor: diferenca,
      formatado: formatValorLocal(diferenca)
    },
    percentualDivergencia: {
      valor: Number(percentualDivergencia.toFixed(2)),
      formatado: formatPercentLocal(percentualDivergencia)
    },
    lucroEstimado: {
      valor: lucroEstimado,
      formatado: formatValorLocal(lucroEstimado)
    },
    totalImpostos: {
      valor: totalImpostos,
      formatado: formatValorLocal(totalImpostos)
    },
    totalFolha: {
      valor: totalFolha,
      formatado: formatValorLocal(totalFolha)
    },
    totalCompras: {
      valor: totalCompras,
      formatado: formatValorLocal(totalCompras)
    },
    impostoRetidoTotal: {
      valor: impostoRetidoTotal,
      formatado: formatValorLocal(impostoRetidoTotal)
    },
    statusDivergencia,
    fonte: 'fallback'
  };
}

function parseValorLocal(valor: any): number {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  const cleaned = String(valor)
    .replace(/[R$\s%]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatValorLocal(valor: number): string {
  const safe = Number.isFinite(valor) ? valor : 0;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercentLocal(valor: number): string {
  const safe = Number.isFinite(valor) ? valor : 0;
  return `${safe.toFixed(2).replace('.', ',')}%`;
}

function computeStatusDivergencia(faturamento: number, diferenca: number): string {
  if (!faturamento) return 'DESCONHECIDO';
  const percentual = Math.abs((diferenca / faturamento) * 100);
  if (percentual <= 5) return 'EXCELENTE';
  if (percentual <= 15) return 'ATENCAO';
  return 'ALERTA';
}

export const fiscalConfig: WorkflowTypeConfig = {
  id: 'fiscal',
  rootTipo: 'SECAO8',
  allowCodeExecution: true,
  outputSchema,
  sectionKeys,
  systemInstruction: [
    'Voce e um assistente de calculos financeiros do parecer.',
    'Use code execution (Python) quando necessario para garantir precisao.',
    'Retorne APENAS JSON, sem markdown.',
    'Nao invente dados. Use apenas o JSON fornecido.',
    'A saida deve seguir EXATAMENTE o schema solicitado.',
    'Estruture o parecer com cabecalho, escopo, analise de dados e conclusao.',
    'Use tom cetico e profissional, baseado em evidencias dos dados.',
    'Valores monetarios devem ter "valor" (numero) e "valorFormatado" (pt-BR com R$).',
    'Percentuais devem ter "valor" (numero) e "valorFormatado" (com %).'
  ].join(' '),
  promptIntro:
    'Use OBRIGATORIAMENTE a tool code_execution para fazer os calculos. ' +
    'Use o JSON de entrada (consolidado) e gere o JSON final do parecer no formato abaixo. ' +
    'A saida deve ser UM unico objeto seguindo o schema, com os calculos do regime tributario.\n\n',
  buildPayload,
  buildBaseFromConsolidado,
  buildFallback,
  isSchemaValid: isCalcSchema,
  buildClassificationPrompt,
  buildClassificationContents,
  routeAgent,
  buildExtractionPrompt,
  buildAgentContents
};
