import type { WorkflowTypeConfig } from './config';
import { atendimentoConfig } from './atendimento';
import { contabilConfig } from './contabil';
import { fiscalConfig } from './fiscal';
import { pessoalConfig } from './pessoal';
import { normalizeParecerType } from '../../../utils/parecer';

const configMap: Record<string, WorkflowTypeConfig> = {
  fiscal: fiscalConfig,
  contabil: contabilConfig,
  atendimento: atendimentoConfig,
  pessoal: pessoalConfig
};

export function resolveWorkflowConfig(tipoParecer?: string | null): WorkflowTypeConfig {
  const key = normalizeParecerType(tipoParecer) || String(tipoParecer || '').toLowerCase();
  return configMap[key] || fiscalConfig;
}
