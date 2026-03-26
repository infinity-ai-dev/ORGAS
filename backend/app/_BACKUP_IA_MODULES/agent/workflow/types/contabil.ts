import type { WorkflowTypeConfig } from './config';
import { fiscalConfig } from './fiscal';

export const contabilConfig: WorkflowTypeConfig = {
  ...fiscalConfig,
  id: 'contabil',
  systemInstruction: `${fiscalConfig.systemInstruction} Considere que o parecer e do tipo contabil.`,
  promptIntro:
    'Use OBRIGATORIAMENTE a tool code_execution para fazer os calculos. ' +
    'Use o JSON de entrada (consolidado) e gere o JSON final do parecer contabil no formato abaixo. ' +
    'A saida deve ser UM unico objeto seguindo o schema, com os calculos do regime tributario.\n\n'
};
