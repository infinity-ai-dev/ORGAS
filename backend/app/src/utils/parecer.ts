export const PARECER_TYPE_LABELS: Record<string, string> = {
  fiscal: 'Parecer Fiscal',
  pessoal: 'Parecer Pessoal',
  contabil: 'Parecer Contábil',
  atendimento: 'Parecer de Atendimento',
  generico: 'Relatório Genérico',
};

export function normalizeParecerType(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const cleaned = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b(relatorio|relatório|parecer|pareceres)\b/gi, '')
    .trim();
  if (!cleaned) {
    return '';
  }
  if (cleaned.includes('pessoal')) return 'pessoal';
  if (cleaned.includes('fiscal')) return 'fiscal';
  if (cleaned.includes('contabil')) return 'contabil';
  if (cleaned.includes('atendimento')) return 'atendimento';
  return '';
}

export function resolveNormalizedParecerType(
  value: unknown,
  fallback: string = 'generico'
): string {
  return normalizeParecerType(value) || fallback;
}

export function getParecerTypeLabel(value: unknown): string {
  const normalized = resolveNormalizedParecerType(value);
  return PARECER_TYPE_LABELS[normalized] || PARECER_TYPE_LABELS.generico;
}

export function buildParecerUiMeta(value: unknown) {
  const tipo_parecer = resolveNormalizedParecerType(value);
  return {
    tipo_parecer,
    tipo_parecer_label: getParecerTypeLabel(tipo_parecer),
    frontend_variant: tipo_parecer,
  };
}

export function resolveParecerTypeFromPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const candidates = [
    payload.tipo_parecer,
    payload.tipoParecer,
    payload.tipo_parecer_nome,
    payload.tipo,
    payload.type,
    payload.tipo_relatorio,
    payload.tipoRelatorio,
    payload.relatorio_type,
    payload.relatorioType,
    payload.categoria,
    payload.category,
    payload.titulo,
    payload.title
  ];
  for (const value of candidates) {
    const normalized = normalizeParecerType(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}
