/**
 * Approval Workflow Service
 * Handles storing, retrieving, and managing report approval workflow
 */

import { reportsQuery } from '../config/database';
import { buildParecerUiMeta, resolveNormalizedParecerType } from '../utils/parecer';

type ApprovalWorkflowTable = 'relatorios_aprovados' | 'relatorios_reprovados';
type ApprovalWorkflowRefColumn = 'relatorio_id' | 'relatorio_original_id';

const approvalWorkflowRefColumnCache = new Map<ApprovalWorkflowTable, ApprovalWorkflowRefColumn>();
const approvalWorkflowTableColumnsCache = new Map<ApprovalWorkflowTable, Set<string>>();

export interface AgentResponse {
  request_id?: string | null;
  requestId?: string | null;
  session_id?: string | null;
  sessionId?: string | null;
  response?: any;  // dict (domain_data) or str (fallback)
  tipo_parecer?: string | null;
  tipoParecer?: string | null;
  steps?: number;
  documents_used?: number;
  documentsUsed?: number;
  domain_data?: any;  // Structured response from orchestrator
  domainData?: any;
  html_output?: string;  // Pre-generated HTML by agent
  htmlOutput?: string;
  client_id?: string | null;
  clientId?: string | null;
  client_name?: string | null;
  clientName?: string | null;
}

export interface RelatorioEmAprovacao {
  id?: string;
  request_id: string;
  task_id?: string;
  report_id?: string;
  cliente_id: string;
  cliente_nome: string;
  tipo_parecer: string;
  tipo_parecer_label?: string;
  frontend_variant?: string;
  response_data: any;
  documentos_analisados?: number;
  etapas_executadas?: number;
}

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getRawResponseData(agentResponse: AgentResponse) {
  return (
    agentResponse.domain_data ??
    agentResponse.domainData ??
    agentResponse.response ??
    null
  );
}

function ensureResponseDataObject(rawValue: unknown): Record<string, any> {
  if (!rawValue) {
    return {};
  }

  if (typeof rawValue === 'string') {
    return { response: rawValue };
  }

  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return { ...(rawValue as Record<string, any>) };
  }

  return { response: rawValue };
}

export async function getApprovalWorkflowRefColumn(
  tableName: ApprovalWorkflowTable
): Promise<ApprovalWorkflowRefColumn> {
  const cached = approvalWorkflowRefColumnCache.get(tableName);
  if (cached) {
    return cached;
  }

  const result = await reportsQuery(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name IN ('relatorio_id', 'relatorio_original_id')
    `,
    [tableName]
  );

  const columns = new Set((result.rows || []).map((row: any) => String(row.column_name)));
  const resolvedColumn: ApprovalWorkflowRefColumn = columns.has('relatorio_id')
    ? 'relatorio_id'
    : columns.has('relatorio_original_id')
      ? 'relatorio_original_id'
      : 'relatorio_id';

  approvalWorkflowRefColumnCache.set(tableName, resolvedColumn);
  return resolvedColumn;
}

function getAlternateApprovalWorkflowRefColumn(
  column: ApprovalWorkflowRefColumn
): ApprovalWorkflowRefColumn {
  return column === 'relatorio_id' ? 'relatorio_original_id' : 'relatorio_id';
}

function isMissingApprovalRefColumnError(error: any, column: ApprovalWorkflowRefColumn) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('does not exist') &&
    (
      message.includes(`column ${column}`) ||
      message.includes(`.${column}`)
    )
  );
}

async function withApprovalWorkflowRefColumn<T>(
  tableName: ApprovalWorkflowTable,
  operation: (refColumn: ApprovalWorkflowRefColumn) => Promise<T>
): Promise<T> {
  const primaryColumn = await getApprovalWorkflowRefColumn(tableName);

  try {
    return await operation(primaryColumn);
  } catch (error: any) {
    if (!isMissingApprovalRefColumnError(error, primaryColumn)) {
      throw error;
    }

    const fallbackColumn = getAlternateApprovalWorkflowRefColumn(primaryColumn);
    approvalWorkflowRefColumnCache.set(tableName, fallbackColumn);
    return operation(fallbackColumn);
  }
}

function decorateResponseDataForStorage(
  agentResponse: AgentResponse,
  context: {
    requestId: string;
    tipoParecer: string;
    clienteId: string;
    clienteNome: string;
    competencia?: string | null;
    clienteCnpj?: string | null;
    documentosAnalisados: number;
    etapasExecutadas: number;
    userEmail?: string | null;
    userName?: string | null;
  }
) {
  const rawResponseData = getRawResponseData(agentResponse);
  const responseData = ensureResponseDataObject(rawResponseData);
  const dadosCabecalho = ensureResponseDataObject(responseData.dadosCabecalho);
  const uiMeta = buildParecerUiMeta(
    pickFirstString(
      responseData.tipo_parecer,
      responseData.tipoParecer,
      agentResponse.tipo_parecer,
      agentResponse.tipoParecer,
      responseData.agent,
      context.tipoParecer
    )
  );

  return {
    ...responseData,
    ...uiMeta,
    dadosCabecalho: {
      ...dadosCabecalho,
      clienteNome: pickFirstString(
        dadosCabecalho.clienteNome,
        dadosCabecalho.razaoSocial,
        dadosCabecalho.razao_social,
        responseData.cliente_nome,
        responseData.client_name,
        responseData.clientName,
        context.clienteNome
      ) || '',
      clienteCnpj: pickFirstString(
        dadosCabecalho.clienteCnpj,
        dadosCabecalho.cnpj,
        responseData.cliente_cnpj,
        responseData.clienteCnpj,
        context.clienteCnpj
      ) || '',
      competencia: pickFirstString(
        dadosCabecalho.competencia,
        responseData.competencia,
        context.competencia
      ) || '',
      periodoApuracao: pickFirstString(
        dadosCabecalho.periodoApuracao,
        responseData.periodoApuracao,
        responseData.competencia,
        context.competencia
      ) || '',
      tipo_parecer: pickFirstString(
        dadosCabecalho.tipo_parecer,
        responseData.tipo_parecer,
        uiMeta.tipo_parecer
      ) || uiMeta.tipo_parecer,
    },
    tipoParecer: uiMeta.tipo_parecer,
    request_id: pickFirstString(responseData.request_id, responseData.requestId, context.requestId),
    owner_email: pickFirstString(
      responseData.owner_email,
      responseData.user_email,
      responseData.analista_email,
      context.userEmail
    ),
    owner_name: pickFirstString(
      responseData.owner_name,
      responseData.user_name,
      responseData.analista_nome,
      context.userName
    ),
    user_email: pickFirstString(
      responseData.user_email,
      responseData.owner_email,
      responseData.analista_email,
      context.userEmail
    ),
    user_name: pickFirstString(
      responseData.user_name,
      responseData.owner_name,
      responseData.analista_nome,
      context.userName
    ),
    analista_email: pickFirstString(
      responseData.analista_email,
      responseData.user_email,
      responseData.owner_email,
      context.userEmail
    ),
    analista_nome: pickFirstString(
      responseData.analista_nome,
      responseData.user_name,
      responseData.owner_name,
      context.userName
    ),
    criador: {
      ...ensureResponseDataObject(responseData.criador),
      email: pickFirstString(
        ensureResponseDataObject(responseData.criador).email,
        responseData.user_email,
        responseData.owner_email,
        responseData.analista_email,
        context.userEmail
      ),
      nome: pickFirstString(
        ensureResponseDataObject(responseData.criador).nome,
        responseData.user_name,
        responseData.owner_name,
        responseData.analista_nome,
        context.userName
      ),
    },
    cliente_id: pickFirstString(
      responseData.cliente_id,
      responseData.client_id,
      responseData.clientId,
      context.clienteId
    ) || '',
    cliente_nome: pickFirstString(
      responseData.cliente_nome,
      responseData.client_name,
      responseData.clientName,
      context.clienteNome
    ) || '',
    competencia: pickFirstString(
      responseData.competencia,
      responseData.periodoApuracao,
      dadosCabecalho.competencia,
      context.competencia
    ),
    cliente_cnpj: pickFirstString(
      responseData.cliente_cnpj,
      responseData.clienteCnpj,
      dadosCabecalho.clienteCnpj,
      dadosCabecalho.cnpj,
      context.clienteCnpj
    ),
    documentos_analisados:
      Number(
        responseData.documentos_analisados ??
          responseData.documentosAnalisados ??
          context.documentosAnalisados
      ) || 0,
    etapas_executadas:
      Number(
        responseData.etapas_executadas ??
          responseData.etapasExecutadas ??
          context.etapasExecutadas
      ) || 0,
  };
}

function serializeRelatorioForFrontend(row: any) {
  const tipoParecer = resolveNormalizedParecerType(
    pickFirstString(
      row?.tipo_parecer,
      row?.response_data?.tipo_parecer,
      row?.response_data?.tipoParecer,
      row?.response_data?.frontend_variant,
      row?.response_data?.agent
    )
  );
  const uiMeta = buildParecerUiMeta(tipoParecer);
  const responseData = ensureResponseDataObject(row?.response_data);

  return {
    ...row,
    ...uiMeta,
    response_data: {
      ...responseData,
      ...uiMeta,
      tipoParecer: uiMeta.tipo_parecer,
      request_id: pickFirstString(
        responseData.request_id,
        responseData.requestId,
        row?.request_id
      ),
      cliente_id: pickFirstString(
        responseData.cliente_id,
        responseData.client_id,
        responseData.clientId,
        row?.cliente_id
      ) || '',
      cliente_nome: pickFirstString(
        responseData.cliente_nome,
        responseData.client_name,
        responseData.clientName,
        row?.cliente_nome
      ) || '',
      documentos_analisados:
        Number(
          responseData.documentos_analisados ??
            responseData.documentosAnalisados ??
            row?.documentos_analisados
        ) || 0,
      etapas_executadas:
        Number(
          responseData.etapas_executadas ??
            responseData.etapasExecutadas ??
            row?.etapas_executadas
        ) || 0,
    },
  };
}

export interface AprovacaoRequest {
  relatorio_id: string;
  aprovado_por: string;
  aprovado_email?: string;
  observacoes_aprovacao?: string;
}

export interface ReprrovacaoRequest {
  relatorio_id: string;
  reprovado_por: string;
  reprovado_email?: string;
  motivo_rejeicao: 'dados_inconsistentes' | 'calculo_errado' | 'campo_faltante' | 'interpretacao_incorreta' | 'dados_incompletos' | 'formato_invalido';
  justificativa: string;
  secoes_com_erro?: string[];
  campo_com_erro?: string;
  valor_esperado?: string;
  valor_recebido?: string;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildInsertStatement(
  tableName: ApprovalWorkflowTable,
  valuesByColumn: Record<string, unknown>
) {
  const columns = Object.keys(valuesByColumn);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  return {
    query: `
      INSERT INTO public.${tableName} (${columns.map(quoteIdentifier).join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING id;
    `,
    params: columns.map((column) => valuesByColumn[column]),
  };
}

function normalizeBigintParam(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}

function getRelatorioStorageMetadata(relatorio: any) {
  const responseData = ensureResponseDataObject(relatorio?.response_data);
  const dadosCabecalho = ensureResponseDataObject(responseData?.dadosCabecalho);
  const uiMeta = buildParecerUiMeta(relatorio?.tipo_parecer);

  return {
    responseData,
    dadosCabecalho,
    uiMeta,
    clienteNome:
      pickFirstString(
        relatorio?.cliente_nome,
        responseData?.cliente_nome,
        responseData?.client_name,
        responseData?.clientName,
        dadosCabecalho?.clienteNome,
        dadosCabecalho?.razaoSocial,
        dadosCabecalho?.razao_social
      ) || 'Cliente',
    clienteCnpj:
      pickFirstString(
        responseData?.cliente_cnpj,
        responseData?.clienteCnpj,
        dadosCabecalho?.clienteCnpj,
        dadosCabecalho?.cnpj
      ) || '',
    competencia:
      pickFirstString(
        relatorio?.competencia,
        responseData?.competencia,
        responseData?.periodoApuracao,
        dadosCabecalho?.competencia,
        dadosCabecalho?.periodoApuracao
      ) || '',
    aiComment:
      pickFirstString(
        responseData?.comentarios?.agente,
        responseData?.personal_summary,
        responseData?.parecerTecnico,
        responseData?.resumo
      ) || null,
  };
}

async function getApprovalWorkflowTableColumns(tableName: ApprovalWorkflowTable) {
  const cached = approvalWorkflowTableColumnsCache.get(tableName);
  if (cached) {
    return cached;
  }

  const result = await reportsQuery(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  const columns = new Set((result.rows || []).map((row: any) => String(row.column_name)));
  approvalWorkflowTableColumnsCache.set(tableName, columns);
  return columns;
}

function isUniqueConstraintViolation(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key value violates unique constraint');
}

async function findExistingApprovalWorkflowRecordId(
  tableName: ApprovalWorkflowTable,
  relatorioId: string
) {
  const columns = await getApprovalWorkflowTableColumns(tableName);

  if (columns.has('relatorio_id') || columns.has('relatorio_original_id')) {
    const result = await withApprovalWorkflowRefColumn(tableName, async (refColumn) =>
      reportsQuery(
        `
          SELECT id
          FROM public.${tableName}
          WHERE ${quoteIdentifier(refColumn)}::text = $1::text
          ORDER BY id DESC
          LIMIT 1;
        `,
        [relatorioId]
      )
    );

    if (result.rows?.[0]?.id != null) {
      return String(result.rows[0].id);
    }
  }

  if (tableName === 'relatorios_reprovados' && columns.has('id')) {
    const result = await reportsQuery(
      `
        SELECT id
        FROM public.relatorios_reprovados
        WHERE id::text = $1::text
        LIMIT 1;
      `,
      [relatorioId]
    );

    if (result.rows?.[0]?.id != null) {
      return String(result.rows[0].id);
    }
  }

  return null;
}

async function syncApprovalStatus(
  relatorioId: string,
  status: 'aprovado' | 'reprovado'
) {
  await reportsQuery(
    `
      UPDATE public.relatorios_em_aprovacao
      SET status_aprovacao = $2
      WHERE id = $1;
    `,
    [relatorioId, status]
  );
}

/**
 * Saves agent response to relatorios_em_aprovacao table
 */
export async function saveRelatorioPendente(
  agentResponse: AgentResponse,
  clienteId: string,
  clienteNome: string,
  context?: {
    competencia?: string | null;
    clienteCnpj?: string | null;
    userEmail?: string | null;
    userName?: string | null;
  }
): Promise<string> {
  const rawResponseData = getRawResponseData(agentResponse);
  const requestId = pickFirstString(
    agentResponse.request_id,
    agentResponse.requestId,
    (rawResponseData as any)?.request_id,
    (rawResponseData as any)?.requestId
  ) || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tipoParecer = resolveNormalizedParecerType(
    pickFirstString(
      agentResponse.tipo_parecer,
      agentResponse.tipoParecer,
      (rawResponseData as any)?.tipo_parecer,
      (rawResponseData as any)?.tipoParecer,
      (rawResponseData as any)?.agent
    ),
    'generico'
  );
  const documentosAnalisados = Number(
    agentResponse.documents_used ?? agentResponse.documentsUsed ?? 0
  ) || 0;
  const etapasExecutadas = Number(agentResponse.steps ?? 0) || 0;
  const normalizedClienteId =
    pickFirstString(clienteId, agentResponse.client_id, agentResponse.clientId) || '';
  const normalizedClienteNome =
    pickFirstString(clienteNome, agentResponse.client_name, agentResponse.clientName) || '';
  const responseData = decorateResponseDataForStorage(agentResponse, {
    requestId,
    tipoParecer,
    clienteId: normalizedClienteId,
    clienteNome: normalizedClienteNome,
    competencia: context?.competencia,
    clienteCnpj: context?.clienteCnpj,
    documentosAnalisados,
    etapasExecutadas,
    userEmail: context?.userEmail,
    userName: context?.userName,
  });

  const query = `
    INSERT INTO public.relatorios_em_aprovacao (
      request_id,
      cliente_id,
      cliente_nome,
      tipo_parecer,
      response_data,
      documentos_analisados,
      etapas_executadas
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id;
  `;

  const result = await reportsQuery(query, [
    requestId,
    normalizedClienteId,
    normalizedClienteNome,
    tipoParecer,
    JSON.stringify(responseData),
    documentosAnalisados,
    etapasExecutadas,
  ]);

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Falha ao salvar relatório em aprovação');
  }

  return result.rows[0].id;
}

/**
 * Retrieves pending reports for approval
 */
export async function getRelatoriosPendentes(
  limit: number = 50,
  offset: number = 0,
  tipoParecerFilter?: string
) {
  let query = `
    SELECT
      id,
      request_id,
      cliente_id,
      cliente_nome,
      tipo_parecer,
      response_data,
      documentos_analisados,
      etapas_executadas,
      data_geracao,
      vencimento_em,
      status_aprovacao
    FROM public.relatorios_em_aprovacao
    WHERE status_aprovacao = 'pendente'
  `;

  const params: any[] = [];

  if (tipoParecerFilter) {
    params.push(tipoParecerFilter);
    query += ` AND tipo_parecer = $${params.length}`;
  }

  query += ` ORDER BY data_geracao DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await reportsQuery(query, params);
  return (result.rows || []).map(serializeRelatorioForFrontend);
}

/**
 * Retrieves approved reports
 */
export async function getRelatoriosAprovados(
  limit: number = 50,
  offset: number = 0,
  tipoParecerFilter?: string
) {
  let query = `
    SELECT
      ra.id,
      COALESCE(
        NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
        NULLIF(to_jsonb(ra)->>'relatorio_original_id', '')
      ) AS relatorio_original_id,
      rap.cliente_id,
      rap.cliente_nome,
      rap.tipo_parecer,
      rap.response_data,
      COALESCE(
        to_jsonb(ra)->>'data_aprovacao',
        to_jsonb(ra)->>'aprovado_em',
        to_jsonb(ra)->>'created_at'
      ) AS data_aprovacao,
      COALESCE(
        to_jsonb(ra)->>'aprovado_por',
        to_jsonb(ra)->>'analista_nome',
        to_jsonb(ra)->>'analista_email'
      ) AS aprovado_por,
      rap.status_aprovacao
    FROM public.relatorios_aprovados ra
    INNER JOIN public.relatorios_em_aprovacao rap ON COALESCE(
      NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
      NULLIF(to_jsonb(ra)->>'relatorio_original_id', '')
    ) = rap.id::text
  `;

  const params: any[] = [];

  if (tipoParecerFilter) {
    params.push(tipoParecerFilter);
    query += ` WHERE rap.tipo_parecer = $${params.length}`;
  }

  query += ` ORDER BY COALESCE(to_jsonb(ra)->>'data_aprovacao', to_jsonb(ra)->>'aprovado_em', to_jsonb(ra)->>'created_at') DESC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await reportsQuery(query, params);
  return (result.rows || []).map(serializeRelatorioForFrontend);
}

/**
 * Retrieves rejected reports
 */
export async function getRelatoriosReprovados(
  limit: number = 50,
  offset: number = 0,
  tipoParecerFilter?: string
) {
  let query = `
    SELECT
      rr.id,
      COALESCE(
        NULLIF(to_jsonb(rr)->>'relatorio_id', ''),
        NULLIF(to_jsonb(rr)->>'relatorio_original_id', '')
      ) AS relatorio_original_id,
      rap.cliente_id,
      rap.cliente_nome,
      rap.tipo_parecer,
      rap.response_data,
      COALESCE(
        to_jsonb(rr)->>'data_rejeicao',
        to_jsonb(rr)->>'created_at'
      ) AS data_rejeicao,
      COALESCE(to_jsonb(rr)->>'motivo_rejeicao', to_jsonb(rr)->>'motivo') AS motivo_rejeicao,
      to_jsonb(rr)->>'justificativa' AS justificativa,
      to_jsonb(rr)->>'campo_com_erro' AS campo_com_erro,
      rap.status_aprovacao
    FROM public.relatorios_reprovados rr
    INNER JOIN public.relatorios_em_aprovacao rap ON COALESCE(
      NULLIF(to_jsonb(rr)->>'relatorio_id', ''),
      NULLIF(to_jsonb(rr)->>'relatorio_original_id', ''),
      NULLIF(to_jsonb(rr)->>'id', '')
    ) = rap.id::text
  `;

  const params: any[] = [];

  if (tipoParecerFilter) {
    params.push(tipoParecerFilter);
    query += ` WHERE rap.tipo_parecer = $${params.length}`;
  }

  query += ` ORDER BY COALESCE(to_jsonb(rr)->>'data_rejeicao', to_jsonb(rr)->>'created_at') DESC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await reportsQuery(query, params);
  return (result.rows || []).map(serializeRelatorioForFrontend);
}

/**
 * Retrieves detailed report data
 */
export async function getRelatorioDetalhes(relatorioId: string) {
  const query = `
    SELECT
      id,
      request_id,
      cliente_id,
      cliente_nome,
      tipo_parecer,
      response_data,
      documentos_analisados,
      etapas_executadas,
      data_geracao,
      vencimento_em,
      status_aprovacao
    FROM public.relatorios_em_aprovacao
    WHERE id = $1;
  `;

  const result = await reportsQuery(query, [relatorioId]);
  return result.rows?.[0] ? serializeRelatorioForFrontend(result.rows[0]) : null;
}

/**
 * Approves a report and moves it to relatorios_aprovados
 */
export async function aprovarRelatorio(req: AprovacaoRequest): Promise<string> {
  const { relatorio_id, aprovado_por, aprovado_email, observacoes_aprovacao } = req;

  // Get the report data
  const relatorio = await getRelatorioDetalhes(relatorio_id);
  if (!relatorio) {
    throw new Error('Relatório não encontrado');
  }

  const existingApprovedId = await findExistingApprovalWorkflowRecordId(
    'relatorios_aprovados',
    relatorio_id
  );
  if (existingApprovedId && relatorio.status_aprovacao === 'aprovado') {
    return existingApprovedId;
  }

  const approvedColumns = await getApprovalWorkflowTableColumns('relatorios_aprovados');
  const { responseData, uiMeta, clienteNome, clienteCnpj, competencia, aiComment } =
    getRelatorioStorageMetadata(relatorio);

  let insertResult;

  try {
    if (approvedColumns.has('aprovado_por')) {
      insertResult = await withApprovalWorkflowRefColumn('relatorios_aprovados', async (refColumn) => {
        const insertQuery = `
          INSERT INTO public.relatorios_aprovados (
            ${refColumn},
            aprovado_por,
            data_aprovacao,
            observacoes_aprovacao,
            response_data
          )
          VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)
          RETURNING id;
        `;

        return reportsQuery(insertQuery, [
          relatorio_id,
          aprovado_por,
          observacoes_aprovacao || '',
          JSON.stringify(responseData),
        ]);
      });
    } else {
      const legacyValues: Record<string, unknown> = {
        relatorio_id,
        titulo: `Parecer ${uiMeta.tipo_parecer_label} - ${clienteNome}`,
        categoria: relatorio.tipo_parecer || uiMeta.frontend_variant || 'parecer',
        cliente_id: normalizeBigintParam(relatorio.cliente_id),
        cliente_nome: clienteNome,
        cnpj_matriz: clienteCnpj || null,
        analista_nome: aprovado_por,
        analista_email: aprovado_email || aprovado_por,
        observacoes: observacoes_aprovacao || '',
        ai_comment: aiComment,
        competencia: competencia || null,
        secoes_json: JSON.stringify(responseData),
        type: relatorio.tipo_parecer || uiMeta.frontend_variant || null,
        relatorio_type: responseData?.relatorio_type || responseData?.tipo || 'Parecer',
      };

      const { query, params } = buildInsertStatement('relatorios_aprovados', legacyValues);
      insertResult = await reportsQuery(query, params);
    }
  } catch (error: any) {
    if (isUniqueConstraintViolation(error)) {
      const existingId = await findExistingApprovalWorkflowRecordId(
        'relatorios_aprovados',
        relatorio_id
      );

      if (existingId) {
        await syncApprovalStatus(relatorio_id, 'aprovado');
        return existingId;
      }
    }

    throw error;
  }

  if (!insertResult.rows || insertResult.rows.length === 0) {
    throw new Error('Falha ao aprover relatório');
  }

  await syncApprovalStatus(relatorio_id, 'aprovado');

  try {
    await logAuditoria(relatorio_id, 'aprovado', aprovado_por, {
      observacoes: observacoes_aprovacao,
    });
  } catch (error: any) {
    console.error('Erro ao registrar auditoria de aprovação:', error.message);
  }

  return insertResult.rows[0].id;
}

/**
 * Rejects a report and moves it to relatorios_reprovados
 * Also adds feedback to feedback_treinamento for model improvement
 */
export async function reprovarRelatorio(req: ReprrovacaoRequest): Promise<string> {
  const {
    relatorio_id,
    reprovado_por,
    reprovado_email,
    motivo_rejeicao,
    justificativa,
    secoes_com_erro = [],
    campo_com_erro,
    valor_esperado,
    valor_recebido,
  } = req;

  // Get the report data
  const relatorio = await getRelatorioDetalhes(relatorio_id);
  if (!relatorio) {
    throw new Error('Relatório não encontrado');
  }

  const existingRejectedId = await findExistingApprovalWorkflowRecordId(
    'relatorios_reprovados',
    relatorio_id
  );
  if (existingRejectedId && relatorio.status_aprovacao === 'reprovado') {
    return existingRejectedId;
  }

  const rejectedColumns = await getApprovalWorkflowTableColumns('relatorios_reprovados');
  const { responseData, clienteNome, clienteCnpj, competencia } =
    getRelatorioStorageMetadata(relatorio);

  let insertResult;

  try {
    if (rejectedColumns.has('reprovado_por')) {
      insertResult = await withApprovalWorkflowRefColumn('relatorios_reprovados', async (refColumn) => {
        const insertQuery = `
          INSERT INTO public.relatorios_reprovados (
            ${refColumn},
            reprovado_por,
            data_rejeicao,
            motivo_rejeicao,
            justificativa,
            secoes_com_erro,
            campo_com_erro,
            valor_esperado,
            valor_recebido,
            response_data
          )
          VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id;
        `;

        return reportsQuery(insertQuery, [
          relatorio_id,
          reprovado_por,
          motivo_rejeicao,
          justificativa,
          secoes_com_erro.length > 0 ? secoes_com_erro : null,
          campo_com_erro || null,
          valor_esperado || null,
          valor_recebido || null,
          JSON.stringify(responseData),
        ]);
      });
    } else {
      const legacyValues: Record<string, unknown> = {
        id: normalizeBigintParam(relatorio_id),
        base64: Buffer.from(JSON.stringify(responseData), 'utf-8').toString('base64'),
        user_name: reprovado_por,
        user_email: reprovado_email || reprovado_por,
        file_name: `${clienteNome}_${relatorio.tipo_parecer || 'parecer'}.json`,
        cnpjMatrizAbreviado: normalizeBigintParam(clienteCnpj),
        competencia: competencia || null,
        motivo: [motivo_rejeicao, justificativa].filter(Boolean).join(': '),
      };

      const { query, params } = buildInsertStatement('relatorios_reprovados', legacyValues);
      insertResult = await reportsQuery(query, params);
    }
  } catch (error: any) {
    if (isUniqueConstraintViolation(error)) {
      const existingId = await findExistingApprovalWorkflowRecordId(
        'relatorios_reprovados',
        relatorio_id
      );

      if (existingId) {
        await syncApprovalStatus(relatorio_id, 'reprovado');
        return existingId;
      }
    }

    throw error;
  }

  if (!insertResult.rows || insertResult.rows.length === 0) {
    throw new Error('Falha ao rejeitar relatório');
  }

  await syncApprovalStatus(relatorio_id, 'reprovado');

  try {
    await agregarFeedbackTreinamento({
      tipo_parecer: relatorio.tipo_parecer,
      motivo_rejeicao,
      campo_com_erro,
      secao: secoes_com_erro?.[0] || null,
      valor_esperado,
      valor_recebido,
    });
  } catch (error: any) {
    console.error('Erro ao agregar feedback de reprovação:', error.message);
  }

  try {
    await logAuditoria(relatorio_id, 'reprovado', reprovado_por, {
      motivo_rejeicao,
      justificativa,
      secoes_com_erro,
    });
  } catch (error: any) {
    console.error('Erro ao registrar auditoria de reprovação:', error.message);
  }

  return insertResult.rows[0].id;
}

/**
 * Aggregates feedback for model training
 * Updates frequency if error pattern already exists
 */
async function agregarFeedbackTreinamento(feedback: {
  tipo_parecer: string;
  motivo_rejeicao: string;
  campo_com_erro?: string;
  secao?: string | null;
  valor_esperado?: string;
  valor_recebido?: string;
}) {
  const { tipo_parecer, motivo_rejeicao, campo_com_erro, secao } = feedback;

  if (!campo_com_erro) return;

  // Check if this error pattern already exists
  const checkQuery = `
    SELECT id, frequencia_erro FROM public.feedback_treinamento
    WHERE tipo_parecer = $1
      AND motivo_rejeicao = $2
      AND campo_com_erro = $3
      AND (secao IS NULL OR secao = $4)
    LIMIT 1;
  `;

  const existingResult = await reportsQuery(checkQuery, [
    tipo_parecer,
    motivo_rejeicao,
    campo_com_erro,
    secao || null,
  ]);

  if (existingResult.rows && existingResult.rows.length > 0) {
    // Update frequency
    const updateQuery = `
      UPDATE public.feedback_treinamento
      SET frequencia_erro = frequencia_erro + 1,
          ultima_ocorrencia = CURRENT_TIMESTAMP,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;
    await reportsQuery(updateQuery, [existingResult.rows[0].id]);
  } else {
    // Insert new feedback entry
    const insertQuery = `
      INSERT INTO public.feedback_treinamento (
        tipo_parecer,
        motivo_rejeicao,
        campo_com_erro,
        secao,
        frequencia_erro,
        prioridade,
        status
      )
      VALUES ($1, $2, $3, $4, 1, 'media', 'novo');
    `;

    await reportsQuery(insertQuery, [
      tipo_parecer,
      motivo_rejeicao,
      campo_com_erro,
      secao || null,
    ]);
  }
}

/**
 * Logs audit trail entry
 */
async function logAuditoria(
  relatorioId: string,
  acao: string,
  usuarioId: string,
  detalhes: any
) {
  const query = `
    INSERT INTO public.auditoria_relatorios (
      relatorio_id,
      acao,
      usuario_id,
      detalhes
    )
    VALUES ($1, $2, $3, $4);
  `;

  await reportsQuery(query, [
    relatorioId,
    acao,
    usuarioId,
    JSON.stringify(detalhes),
  ]);
}

/**
 * Gets feedback statistics for dashboard
 */
export async function getFeedbackStats(tipoParecerFilter?: string) {
  let query = `
    SELECT
      tipo_parecer,
      motivo_rejeicao,
      COUNT(*) as total_ocorrencias,
      COUNT(DISTINCT campo_com_erro) as campos_afetados,
      AVG(frequencia_erro) as frequencia_media,
      MAX(ultima_ocorrencia) as ultima_ocorrencia
    FROM public.feedback_treinamento
  `;

  const params: any[] = [];

  if (tipoParecerFilter) {
    params.push(tipoParecerFilter);
    query += ` WHERE tipo_parecer = $${params.length}`;
  }

  query += `
    GROUP BY tipo_parecer, motivo_rejeicao
    ORDER BY total_ocorrencias DESC;
  `;

  const result = await reportsQuery(query, params);
  return result.rows || [];
}

/**
 * Gets top problematic fields for a parecer type
 */
export async function getProblematicFields(tipoParecerFilter: string) {
  const query = `
    SELECT
      campo_com_erro,
      motivo_rejeicao,
      COUNT(*) as frequencia,
      array_agg(DISTINCT secao) as secoes_afetadas
    FROM public.feedback_treinamento
    WHERE tipo_parecer = $1
    GROUP BY campo_com_erro, motivo_rejeicao
    ORDER BY frequencia DESC
    LIMIT 20;
  `;

  const result = await reportsQuery(query, [tipoParecerFilter]);
  return result.rows || [];
}
