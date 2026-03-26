import {
  AGENTE_1_SYSTEM_PROMPT,
  AGENTE_2_SYSTEM_PROMPT,
  AGENTE_3_SYSTEM_PROMPT,
  AGENTE_4_SYSTEM_PROMPT,
  AGENTE_5_SYSTEM_PROMPT,
  AGENTE_5_LITE_SYSTEM_PROMPT,
  CLASSIFICACAO_SYSTEM_PROMPT
} from '../../prompts';
import { withReferences } from '../utils';

export function buildClassificationPrompt(referenceContext: string) {
  return withReferences(CLASSIFICACAO_SYSTEM_PROMPT, referenceContext);
}

type ClassificationScopeOptions = {
  reportLabel?: string;
  allowedTypes?: string[];
};

export function buildScopedClassificationPrompt(
  referenceContext: string,
  options: ClassificationScopeOptions = {}
) {
  const { reportLabel, allowedTypes } = options;
  if (!allowedTypes || allowedTypes.length === 0) {
    return buildClassificationPrompt(referenceContext);
  }

  const headerLines = [
    '# ORQUESTRADOR DE CLASSIFICACAO',
    reportLabel ? `Relatorio: ${reportLabel}` : null,
    'Use APENAS os tipos abaixo para este relatorio:',
    ...allowedTypes.map((tipo) => `- ${tipo}`),
    'Se o documento nao se encaixar nesses tipos, retorne tipo "DESCONHECIDO" e explique na observacao.',
    'Esta regra tem prioridade sobre qualquer instrucao abaixo.',
    'Ignore qualquer outra lista de tipos nas instrucoes abaixo.'
  ].filter(Boolean);

  const scopedPrompt = `${headerLines.join('\n')}\n\n${CLASSIFICACAO_SYSTEM_PROMPT}`;
  return withReferences(scopedPrompt, referenceContext);
}

export function buildClassificationContents(doc: any, context: any) {
  const clienteNome = context?.clientName || 'Não informado';
  const regimeTributario = context?.regimeTributario || 'Não informado';
  const sizeKb = doc.size ? (doc.size / 1024).toFixed(2) : '0.00';

  return [
    {
      role: 'user' as const,
      parts: [
        {
          text: `# DOCUMENTO PARA CLASSIFICAR\n\n**Cliente:** ${clienteNome}\n**Regime Tributário:** ${regimeTributario}\n**Nome do Arquivo:** ${doc.documentoNome}\n**Tamanho:** ${sizeKb} KB\n\nPor favor, classifique este documento seguindo RIGOROSAMENTE as instruções acima.\nRetorne APENAS o JSON, sem markdown, sem explicações extras.`
        }
      ]
    },
    {
      role: 'user' as const,
      parts: [
        {
          file_data: {
            file_uri: doc.fileUri,
            mime_type: doc.mimeType
          }
        }
      ]
    }
  ];
}

export function routeAgent(tipo: string) {
  if (!tipo) return null;
  if (tipo === 'EXTRATO_BANCARIO' || tipo === 'EXTRATO_CARTAO') return 'AGENTE_1';
  if (tipo === 'PGDAS_XML' || tipo === 'PGDAS_PDF' || tipo === 'GUIA_DAS') return 'AGENTE_2';
  if (tipo === 'FOLHA_PAGAMENTO') return 'AGENTE_3';
  if (tipo === 'PONTO_JORNADA') return 'AGENTE_5';
  if (
    tipo === 'NFE_XML' ||
    tipo === 'NFSE_XML' ||
    tipo === 'NFSE_PDF' ||
    tipo === 'CTE_XML' ||
    tipo === 'RESUMO_ACUMULADOR'
  )
    return 'AGENTE_4';
  return null;
}

export function routeAgentWithAllowList(tipo: string, allowList?: string[]) {
  if (!allowList || allowList.length === 0) {
    return routeAgent(tipo);
  }
  if (!allowList.includes(tipo)) return null;
  return routeAgent(tipo);
}

export function getAgentPrompt(agent: string) {
  let prompt = '';
  switch (agent) {
    case 'AGENTE_1':
      prompt = AGENTE_1_SYSTEM_PROMPT;
      break;
    case 'AGENTE_2':
      prompt = AGENTE_2_SYSTEM_PROMPT;
      break;
    case 'AGENTE_3':
      prompt = AGENTE_3_SYSTEM_PROMPT;
      break;
    case 'AGENTE_4':
      prompt = AGENTE_4_SYSTEM_PROMPT;
      break;
    case 'AGENTE_5':
      prompt = AGENTE_5_SYSTEM_PROMPT;
      break;
    case 'AGENTE_5_LITE':
      prompt = AGENTE_5_LITE_SYSTEM_PROMPT;
      break;
    default:
      prompt = AGENTE_1_SYSTEM_PROMPT;
  }
  return prompt.startsWith('=') ? prompt.slice(1) : prompt;
}

export function buildExtractionPrompt(agent: string, referenceContext: string) {
  return withReferences(getAgentPrompt(agent), referenceContext);
}

export function buildAgentContents(classification: any, context: any) {
  const clienteNome = context?.clientName || classification.clientName || 'Não informado';
  const cnpj = classification.cnpjDetectado || 'não informado';
  const periodo = classification.periodoDetectado || 'não informado';

  return [
    {
      role: 'user' as const,
      parts: [
        {
          text: `Cliente: ${clienteNome}\nCNPJ: ${cnpj}\nPeriodo: ${periodo}\n\nExtraia todas as entradas.`
        }
      ]
    },
    {
      role: 'user' as const,
      parts: [
        {
          file_data: {
            file_uri: classification.file_uri,
            mime_type: classification.mime_type
          }
        }
      ]
    }
  ];
}
