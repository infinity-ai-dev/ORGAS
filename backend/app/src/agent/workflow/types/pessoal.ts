import { isParecerPessoalSchema } from './validators';
import type { WorkflowTypeConfig } from './config';
import {
  buildAgentContents,
  buildClassificationContents,
  buildScopedClassificationPrompt,
  buildExtractionPrompt,
  routeAgentWithAllowList
} from './defaults';

const outputSchema = `{
  "tipo": "PARECER_PESSOAL",
  "dadosCabecalho": { "clienteNome": "", "clienteCnpj": "", "competencia": "", "periodoApuracao": "", "dataEmissao": "", "tipo_parecer": "" },
  "valoresPagamento": { "itens": [{ "descricao": "", "valor": "R$ 0,00", "vencimento": "", "dataPagamento": "", "fonte": "" }], "observacoes": "" },
  "controleJornada": {
    "metodo": "",
    "documentosRecebidos": [],
    "pendencias": [],
    "alertas": "",
    "jornadas": [
      {
        "funcionario": "",
        "cargo": "",
        "diasTrabalhados": 0,
        "horasTrabalhadas": "",
        "horasExtras": "",
        "atrasos": "",
        "faltas": "",
        "observacoes": ""
      }
    ],
    "resumo": {
      "totalFuncionarios": 0,
      "totalHorasTrabalhadas": "",
      "totalHorasExtras": "",
      "totalAtrasos": "",
      "totalFaltas": ""
    }
  },
  "alteracoesMes": { "comparativo": { "mesAnterior": "", "mesAtual": "", "variacaoPercentual": "" }, "eventos": [], "variaveis": [], "observacoes": "" },
  "eventosDP": { "ferias": [], "desligamentos": [], "admissoes": [], "afastamentos": [] },
  "consignado": { "temConsignado": false, "contratos": [], "observacoes": "" },
  "pontosAtencao": { "itens": [], "observacoes": "" },
  "avisosPendencias": { "itens": [], "observacoes": "" },
  "anexos": { "documentos": [] },
  "comentarios": { "agente": "", "analista": "" },
  "parecerTecnico": { "cabecalho": "", "escopo": "", "analise": [], "conclusao": "", "recomendacoes": [], "conformidade": { "status": "", "itens": [] } }
}`;

const sectionKeys = [
  'dadosCabecalho',
  'valoresPagamento',
  'controleJornada',
  'alteracoesMes',
  'eventosDP',
  'consignado',
  'pontosAtencao',
  'avisosPendencias',
  'anexos',
  'comentarios',
  'parecerTecnico'
];

const allowedDocumentTypes = ['FOLHA_PAGAMENTO', 'PONTO_JORNADA'];

function buildPessoalClassificationPrompt(referenceContext: string) {
  const scoped = buildScopedClassificationPrompt(referenceContext, {
    reportLabel: 'parecer pessoal',
    allowedTypes: allowedDocumentTypes
  });
  return `${scoped}\n\n# ORIENTACAO EXTRA\nPara parecer pessoal, documentos de IRRF, FGTS, INSS, DARF, guias de encargos, holerites e resumos de folha devem ser classificados como FOLHA_PAGAMENTO.`;
}

function routePessoalAgent(tipo: string) {
  return routeAgentWithAllowList(tipo, allowedDocumentTypes);
}

function buildPayload(state: any, classificacoesResumo: any[], uploadResumo: any[]) {
  return {
    consolidated: state.consolidated,
    documentos: classificacoesResumo,
    uploads: uploadResumo,
    resultados: Array.isArray(state.extractions) ? state.extractions : []
  };
}

function buildBaseFromConsolidado(state: any) {
  return buildParecerPessoalFallback(state) || {};
}

function buildFallback(state: any) {
  return buildParecerPessoalFallback(state);
}

export function buildParecerPessoalFallback(state: any) {
  const context = state.context || null;
  const request = state.request || {};
  const competencia = (request as any).competencia || '';
  const clienteNome = context?.clientName || (request as any).clientName || '';
  const tipoParecer = String((request as any).tipoParecer || '').toLowerCase();
  const relatorioType = String((request as any).categoria || '').toLowerCase();
  let clienteCnpj = '';
  if (Array.isArray(state.classifications)) {
    for (const item of state.classifications) {
      if (item?.cnpjDetectado) {
        clienteCnpj = item.cnpjDetectado;
        break;
      }
    }
  }
  const anexosDocs = (state.uploads || []).map((doc: any) => ({
    nome: doc.documentoNome,
    tipo: doc.documentoTipo || doc.mimeType || '',
    mimeType: doc.mimeType
  }));
  const documentosRecebidos = anexosDocs.map((doc: any) => doc.nome);

  return {
    tipo: 'PARECER_PESSOAL',
    dadosCabecalho: {
      clienteNome,
      clienteCnpj,
      competencia,
      periodoApuracao: competencia || '',
      dataEmissao: new Date().toISOString(),
      tipo_parecer: tipoParecer || 'pessoal',
      relatorio_type: relatorioType || undefined
    },
    valoresPagamento: { itens: [], observacoes: '' },
    controleJornada: { metodo: '', documentosRecebidos, pendencias: [], alertas: '' },
    alteracoesMes: {
      comparativo: { mesAnterior: '', mesAtual: '', variacaoPercentual: '' },
      eventos: [],
      variaveis: [],
      observacoes: ''
    },
    eventosDP: { ferias: [], desligamentos: [], admissoes: [], afastamentos: [] },
    consignado: { temConsignado: false, contratos: [], observacoes: '' },
    pontosAtencao: { itens: [], observacoes: '' },
    avisosPendencias: { itens: [], observacoes: '' },
    anexos: { documentos: anexosDocs },
    comentarios: { agente: '', analista: '' },
    parecerTecnico: {
      cabecalho: `Cliente ${clienteNome || 'N/D'} - Competencia ${competencia || 'N/D'}`,
      escopo: 'Documentos analisados conforme seção de anexos.',
      analise: [],
      conclusao: '',
      recomendacoes: [],
      conformidade: { status: '', itens: [] }
    }
  };
}

export const pessoalConfig: WorkflowTypeConfig = {
  id: 'pessoal',
  rootTipo: 'PARECER_PESSOAL',
  allowCodeExecution: false,
  outputSchema,
  sectionKeys,
  systemInstruction: [
    'Voce e um assistente que gera parecer pessoal (Departamento Pessoal).',
    'Nao use code execution.',
    'Parecer pessoal nao inclui regime tributario.',
    'Retorne APENAS JSON, sem markdown.',
    'Nao invente dados. Use apenas o JSON fornecido e as referencias.',
    'A saida deve seguir EXATAMENTE o schema solicitado.',
    'Estruture o parecer com cabecalho, escopo, analise de dados e conclusao.',
    'Use tom cetico e profissional, baseado em evidencias dos dados.'
  ].join(' '),
  promptIntro:
    'Gere o JSON final do parecer pessoal seguindo o schema abaixo. ' +
    'Nao use code execution. ' +
    'Use apenas os dados do INPUT e das referencias. ' +
    'A saida deve ser UM unico objeto seguindo o schema.\n\n',
  buildPayload,
  buildBaseFromConsolidado,
  buildFallback,
  isSchemaValid: isParecerPessoalSchema,
  buildClassificationPrompt: buildPessoalClassificationPrompt,
  buildClassificationContents,
  routeAgent: routePessoalAgent,
  buildExtractionPrompt,
  buildAgentContents
};
