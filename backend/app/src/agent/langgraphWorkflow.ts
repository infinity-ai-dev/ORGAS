import crypto from 'crypto';
import path from 'path';
import {
  callGeminiGenerateContent,
  uploadFileToGemini,
  waitForFileActive
} from './geminiWorkflowClient';
import { loadReferences } from './context';
import { consolidarDados } from './consolidation';
import { calcularAliquotaProgressiva } from './tax';
import { resolveWorkflowConfig } from './workflow/types/registry';
import type { AgentRequest, AgentResult } from './agentService';

type WorkflowContext = {
  requestId: string;
  reportId?: string | number;
  clientId?: string;
  clientName?: string;
  regimeTributario?: string;
  categoria?: string;
};

type NormalizedDocument = {
  index: number;
  documentoIndex: number;
  documentoNome: string;
  documentoTipo?: string;
  fileUri?: string;
  mimeType: string;
  buffer?: Buffer;
  inputFormat?: 'base64' | 'json' | 'csv' | 'text';
  normalizedText?: string;
  size: number;
  totalDocumentos: number;
  reportId?: string | number;
  clientId?: string;
  clientName?: string;
  regimeTributario?: string;
};

type UploadedDocument = NormalizedDocument & {
  fileUri: string;
  state: string;
  mimeType: string;
};

type ClassificationResult = {
  reportId?: string | number;
  documentoIndex: number;
  documentoNome: string;
  clientId?: string;
  clientName?: string;
  regimeTributario?: string;
  file_uri: string;
  mime_type: string;
  state: string;
  tipo: string;
  tipoCategoria: string;
  formato: string;
  confianca: number;
  precisaRevisao: boolean;
  indicadoresEncontrados: string[];
  observacao: string;
  cnpjDetectado: string | null;
  periodoDetectado: string | null;
  totalDocumentos: number;
  timestamp: string;
  _debug?: Record<string, unknown>;
};

type WorkflowState = {
  request: AgentRequest;
  context: WorkflowContext | null;
  normalizedDocs: NormalizedDocument[];
  uploads: UploadedDocument[];
  classifications: ClassificationResult[];
  extractions: any[];
  consolidated: any;
  calc: any;
  referenceContext: string;
  response: string;
  errors: string[];
};

class RunnableLambda<TState> {
  private fn: (state: TState) => Promise<Partial<TState>>;

  constructor(options: { func: (state: TState) => Promise<Partial<TState>> }) {
    this.fn = options.func;
  }

  async invoke(state: TState): Promise<Partial<TState>> {
    return this.fn(state);
  }
}

export async function runDocumentWorkflow(
  request: AgentRequest,
  logTask: (task: string, detail?: string) => void
): Promise<AgentResult> {
  const requestId = request.requestId || crypto.randomUUID();
  const graph = buildWorkflowGraph(logTask);
  const finalState = await graph.invoke({ request: { ...request, requestId } });

  return {
    requestId,
    response: finalState.response || '',
    referencesUsed: 0,
    dbContext: [],
    redisContext: {}
  };
}

function buildWorkflowGraph(logTask: (task: string, detail?: string) => void) {
  const normalizeNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const request = state.request || ({} as AgentRequest);
      const requestId = request.requestId || crypto.randomUUID();
      const reportId = request.reportId ?? request.threadId ?? requestId;

      const context: WorkflowContext = {
        requestId,
        reportId,
        clientId: request.clientId,
        clientName: request.clientName,
        regimeTributario: request.regimeTributario,
        categoria: request.categoria
      };

      const referenceContext = await loadReferenceContext(logTask, request);
      const normalizedDocs = normalizeDocuments(request, context);
      logTask('workflow_normalizar', `docs=${normalizedDocs.length}`);

      return {
        context,
        normalizedDocs,
        referenceContext
      };
    }
  });

  const uploadNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const apiKey = readEnvOrFile('GEMINI_API_KEY', logTask);
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY não configurada (use GEMINI_API_KEY ou GEMINI_API_KEY_FILE)');
      }

      const delayMs = getNumberEnv('GEMINI_UPLOAD_DELAY_MS', 0);
      const pollAttempts = getNumberEnv('GEMINI_FILE_POLL_ATTEMPTS', 10);
      const pollDelay = getNumberEnv('GEMINI_FILE_POLL_DELAY_MS', 3000);
      const extractorModel = process.env.GEMINI_EXTRACTOR_MODEL || 'gemini-2.5-pro';

      const uploads: UploadedDocument[] = [];
      for (const doc of state.normalizedDocs) {
        if (doc.fileUri) {
          logTask('upload_skip', doc.documentoNome);
          uploads.push({
            ...doc,
            fileUri: doc.fileUri,
            state: 'ACTIVE',
            mimeType: doc.mimeType
          });
          continue;
        }

        if (!doc.buffer || doc.buffer.length === 0) {
          throw new Error(`Documento sem conteúdo: ${doc.documentoNome}`);
        }

        logTask('upload_iniciar', doc.documentoNome);
        const uploadInfo = await uploadFileToGemini(
          {
            apiKey,
            buffer: doc.buffer,
            mimeType: doc.mimeType,
            displayName: doc.documentoNome
          },
          logTask
        );

        const activeInfo = await waitForFileActive(
          {
            apiKey,
            fileUri: uploadInfo.uri,
            maxAttempts: pollAttempts,
            delayMs: pollDelay
          },
          logTask
        );

        uploads.push({
          ...doc,
          fileUri: activeInfo.uri,
          state: activeInfo.state || 'ACTIVE',
          mimeType: activeInfo.mimeType || doc.mimeType
        });

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      logTask('workflow_uploads', `uploads=${uploads.length}`);
      return { uploads };
    }
  });

  const classifyNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const tipoParecer = String(state.request?.tipoParecer || '').toLowerCase();
      const typeConfig = resolveWorkflowConfig(tipoParecer);
      const apiKey = readEnvOrFile('GEMINI_API_KEY', logTask);
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY não configurada (use GEMINI_API_KEY ou GEMINI_API_KEY_FILE)');
      }

      const model = process.env.GEMINI_CLASSIFIER_MODEL || 'gemini-2.5-pro';
      const delayMs = getNumberEnv('GEMINI_CLASSIFIER_DELAY_MS', 0);

      const results: ClassificationResult[] = [];
      for (const doc of state.uploads) {
        const contents = typeConfig.buildClassificationContents(doc, state.context);
        const systemInstruction = typeConfig.buildClassificationPrompt(state.referenceContext);

        try {
          const { text } = await callGeminiGenerateContent(
            {
              apiKey,
              model,
              systemInstruction,
              contents,
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2000,
                topP: 0.85,
                topK: 20,
                responseMimeType: 'application/json'
              },
              forceDisableTools: !typeConfig.allowCodeExecution
            },
            logTask
          );

          const classification = processClassification(text, doc, state.context);
          results.push(classification);
        } catch (error: any) {
          logTask('classificacao_erro', `${doc.documentoNome} ${error?.message || error}`);
          results.push({
            reportId: doc.reportId,
            documentoIndex: doc.documentoIndex,
            documentoNome: doc.documentoNome,
            clientId: doc.clientId,
            clientName: doc.clientName,
            regimeTributario: doc.regimeTributario,
            file_uri: doc.fileUri,
            mime_type: doc.mimeType,
            state: doc.fileUri ? 'ACTIVE' : 'ERRO',
            tipo: 'DESCONHECIDO',
            tipoCategoria: 'desconhecido',
            formato: 'PDF_ESTRUTURADO',
            confianca: 0,
            precisaRevisao: true,
            indicadoresEncontrados: [],
            observacao: `Erro na classificação: ${error?.message || 'erro'}`,
            cnpjDetectado: null,
            periodoDetectado: null,
            totalDocumentos: doc.totalDocumentos,
            timestamp: new Date().toISOString()
          });
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      logTask('workflow_classificacao', `classificados=${results.length}`);
      return { classifications: results };
    }
  });

  const extractNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const tipoParecer = String(state.request?.tipoParecer || '').toLowerCase();
      const typeConfig = resolveWorkflowConfig(tipoParecer);
      const apiKey = readEnvOrFile('GEMINI_API_KEY', logTask);
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY não configurada (use GEMINI_API_KEY ou GEMINI_API_KEY_FILE)');
      }

      const model = process.env.GEMINI_EXTRACTOR_MODEL || 'gemini-2.5-pro';
      const delayMs = getNumberEnv('GEMINI_EXTRACTOR_DELAY_MS', 0);

      const outputs: any[] = [];
      const runExtraction = async (options: {
        systemInstruction: string;
        contents: any[];
        maxOutputTokens?: number;
        responseMimeType?: string | null;
      }) => {
        const mime =
          options.responseMimeType === undefined ? 'application/json' : options.responseMimeType;
        const generationConfig: any = {
          temperature: 0.1,
          maxOutputTokens: options.maxOutputTokens ?? 5000
        };
        if (mime) {
          generationConfig.responseMimeType = mime;
        }
        const { systemInstruction, contents, maxOutputTokens } = options;
        return callGeminiGenerateContent(
          {
            apiKey,
            model,
            systemInstruction,
            contents,
            generationConfig,
            forceDisableTools: !typeConfig.allowCodeExecution
          },
          logTask
        );
      };

      const shouldFallbackJornada = (result: any) => {
        if (!result || typeof result !== 'object') return true;
        if (result.semDados) return false;
        const jornadasDiarias = Array.isArray(result.jornadasDiarias) ? result.jornadasDiarias : [];
        const hasDailyData = jornadasDiarias.some((item: any) => {
          const batidas = Array.isArray(item?.batidas) ? item.batidas : [];
          const hasBatidas = batidas.some((batida: any) => String(batida || '').trim());
          const hasObservacao = Boolean(String(item?.observacao || '').trim());
          return hasBatidas || hasObservacao;
        });
        if (hasDailyData) return false;
        const funcionarios = Array.isArray(result.funcionarios) ? result.funcionarios : [];
        if (funcionarios.length === 0) return true;
        const toMinutes = (value: any) => {
          if (typeof value === 'number') return value;
          if (!value) return 0;
          const raw = String(value).trim();
          if (!raw) return 0;
          if (raw.includes(':')) {
            const [h, m] = raw.split(':').map((item) => Number(item));
            return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
          }
          const numeric = Number(raw.replace(/\./g, '').replace(',', '.'));
          return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
        };
        let anyMinutes = false;
        let anyDias = false;
        for (const func of funcionarios) {
          const dias = Number(func?.diasTrabalhados ?? func?.dias ?? 0);
          const totalMinutes =
            toMinutes(func?.horasTrabalhadas) +
            toMinutes(func?.horasExtras) +
            toMinutes(func?.atrasos) +
            toMinutes(func?.faltas);
          if (dias > 0) {
            anyDias = true;
          }
          if (totalMinutes > 0) {
            anyMinutes = true;
          }
        }
        if (anyMinutes) return false;
        // Se há dias mas nenhuma hora totalizada, forçar fallback para somar marcações diárias.
        if (anyDias) return true;
        return true;
      };

      const safeParseJson = (text: string) => {
        if (!text) return null;
        try {
          return JSON.parse(cleanJson(text));
        } catch {
          return null;
        }
      };

      const cleanCsvText = (text: string) => {
        if (!text) return '';
        return text
          .replace(/```[a-zA-Z]*\n?/g, '')
          .replace(/```/g, '')
          .replace(/^csv\s*:/i, '')
          .trim();
      };

      const detectDelimiter = (line: string) => {
        const counts = {
          ',': (line.match(/,/g) || []).length,
          ';': (line.match(/;/g) || []).length,
          '\t': (line.match(/\t/g) || []).length
        };
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return entries[0][1] > 0 ? entries[0][0] : ',';
      };

      const parseCsvRow = (line: string, delimiter = ',') => {
        const out: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              current += '"';
              i += 1;
            } else {
              inQuotes = !inQuotes;
            }
            continue;
          }
          if (ch === delimiter && !inQuotes) {
            out.push(current);
            current = '';
            continue;
          }
          current += ch;
        }
        out.push(current);
        return out.map((item) => item.trim());
      };

      const parseCsvToJornadas = (csv: string, classification: ClassificationResult) => {
        const cleaned = cleanCsvText(csv);
        if (!cleaned) return null;
        const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length < 1) return null;
        const normalizeName = (value: string) => {
          const cleanedName = String(value || '')
            .replace(/^nome\s*:?/i, '')
            .replace(/^funcionario\s*:?/i, '')
            .replace(/^colaborador\s*:?/i, '')
            .replace(/^empregado\s*:?/i, '')
            .replace(/^[\-\u2022•\*]+\s*/g, '')
            .replace(/\b\d{1,2}[.:]\d{2}\b/g, '')
            .replace(/[^\p{L}\s.'-]/gu, '')
            .trim();
          if (!cleanedName) return '';
          return cleanedName
            .split(/\s+/)
            .map((part) => {
              if (part.length <= 2) return part.toUpperCase();
              return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            })
            .join(' ');
        };
        const normalizeHeader = (value: string) =>
          value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase();
        const headerNameLabels = new Set(['FUNCIONARIO', 'COLABORADOR', 'NOME', 'EMPREGADO']);
        const headerDayLabels = new Set(['DIA', 'DATA']);
        const isGenericNameLabel = (value: string) => headerNameLabels.has(normalizeHeader(value));
        const delimiter = detectDelimiter(lines[0]);
        const headerRaw = parseCsvRow(lines[0], delimiter);
        const header = headerRaw.map((h) => normalizeHeader(h));
        const findHeader = (candidates: string[]) =>
          header.findIndex((h) => candidates.some((candidate) => h === candidate));

        let idxFuncionario = findHeader(['FUNCIONARIO', 'COLABORADOR', 'NOME', 'EMPREGADO']);
        let idxDia = findHeader(['DIA', 'DATA']);
        let idxObs = findHeader(['OBSERVACAO', 'OBS', 'OCORRENCIA', 'EVENTO']);
        let idxB1 = findHeader(['BATIDA1', 'BATIDA01', 'ENTRADA1', 'ENTRADA01', 'INICIO1', 'HORA1', '1']);
        let idxB2 = findHeader(['BATIDA2', 'BATIDA02', 'SAIDA1', 'SAIDA01', 'FIM1', 'HORA2', '2']);
        let idxB3 = findHeader(['BATIDA3', 'BATIDA03', 'ENTRADA2', 'ENTRADA02', 'INICIO2', 'HORA3', '3']);
        let idxB4 = findHeader(['BATIDA4', 'BATIDA04', 'SAIDA2', 'SAIDA02', 'FIM2', 'HORA4', '4']);
        let startRow = 1;

        if (idxFuncionario === -1 || idxDia === -1) {
          // CSV sem cabeçalho: assumir posições padrão.
          idxFuncionario = 0;
          idxDia = 1;
          idxB1 = 2;
          idxB2 = 3;
          idxB3 = 4;
          idxB4 = 5;
          idxObs = 6;
          startRow = 0;
        }

        const normalizeTime = (value: string) => {
          if (!value) return '';
          const match = value.match(/\b(\d{1,2})[.:](\d{2})\b/);
          if (!match) return '';
          const h = String(Number(match[1])).padStart(2, '0');
          return `${h}:${match[2]}`;
        };

        const extractTimes = (value: string) => {
          if (!value) return [];
          const matches = String(value).match(/\b\d{1,2}[.:]\d{2}\b/g);
          if (!matches) return [];
          return matches.map((item) => normalizeTime(item)).filter(Boolean);
        };
        const calcHoras = (batidas: string[]) => {
          if (!batidas || batidas.length < 2) return 0;
          const toMinutes = (value: string) => {
            if (!value) return null;
            const match = value.match(/\b(\d{1,2}):(\d{2})\b/);
            if (!match) return null;
            return Number(match[1]) * 60 + Number(match[2]);
          };
          const parts = batidas
            .flatMap((value) => extractTimes(value))
            .map((value) => toMinutes(value))
            .filter((value) => value !== null) as number[];
          if (parts.length < 2) return 0;
          let total = 0;
          for (let i = 0; i + 1 < parts.length; i += 2) {
            const diff = parts[i + 1] - parts[i];
            if (diff > 0) total += diff;
          }
          return total;
        };

        let jornadasDiarias: any[] = [];
        const funcionariosResumo: Record<
          string,
          { nome: string; dias: number; minutos: number; extras: number; observacoes: string[] }
        > = {};

        let lastName = '';
        for (let i = startRow; i < lines.length; i += 1) {
          const cols = parseCsvRow(lines[i], delimiter);
          const rawName = cols[idxFuncionario] || '';
          let name = normalizeName(rawName);
          if (name && /^nome$/i.test(name)) {
            name = '';
          }
          const rawDia = cols[idxDia] || '';
          const diaHeader = normalizeHeader(rawDia || '');
          if (isGenericNameLabel(rawName) && (headerDayLabels.has(diaHeader) || !diaHeader)) {
            continue;
          }
          let observacao = idxObs >= 0 ? cols[idxObs] || '' : '';
          const batidas = [
            idxB1 >= 0 ? normalizeTime(cols[idxB1] || '') : '',
            idxB2 >= 0 ? normalizeTime(cols[idxB2] || '') : '',
            idxB3 >= 0 ? normalizeTime(cols[idxB3] || '') : '',
            idxB4 >= 0 ? normalizeTime(cols[idxB4] || '') : ''
          ];
          const timeTokens = cols
            .map((value, idx) => {
              if (idx === idxFuncionario || idx === idxDia || idx === idxObs) return [];
              return extractTimes(value || '');
            })
            .flat();
          const normalizedBatidas = batidas.map((value) => normalizeTime(value));
          const effectiveBatidas = normalizedBatidas.some((item) => item)
            ? normalizedBatidas.map((item, index) => {
                if (item) return item;
                const nextToken = timeTokens.find((token) => !normalizedBatidas.includes(token));
                return nextToken || '';
              })
            : timeTokens.slice(0, 4);
          const hasBatidas = effectiveBatidas.some((item) => item);
          const hasObservacao = Boolean(observacao);
          const diaMatch = String(rawDia).match(/\b(\d{1,2})\b/);
          const dia = diaMatch ? diaMatch[0].padStart(2, '0') : '';
          if (!dia && !hasObservacao) {
            const diaUpper = String(rawDia || '').toUpperCase();
            if (/S[ÁA]BADO|DOMINGO|FERIADO|ATESTADO|RECESSO|F[ÉE]RIAS/.test(diaUpper)) {
              observacao = observacao || rawDia;
            }
          }
          if (isGenericNameLabel(rawName) || isGenericNameLabel(name)) {
            name = '';
          }
          if (!name) {
            if (lastName && (dia || hasBatidas || observacao)) {
              name = lastName;
            } else {
              continue;
            }
          } else {
            if (isGenericNameLabel(name)) {
              name = '';
              if (lastName && (dia || hasBatidas || observacao)) {
                name = lastName;
              } else {
                continue;
              }
            }
            lastName = name;
          }
          if (!dia && !hasBatidas && !observacao) {
            continue;
          }
          jornadasDiarias.push({ funcionario: name, dia, batidas: effectiveBatidas, observacao });
          if (!funcionariosResumo[name]) {
            funcionariosResumo[name] = { nome: name, dias: 0, minutos: 0, extras: 0, observacoes: [] };
          }
          const dayMinutes = hasBatidas ? calcHoras(effectiveBatidas) : 0;
          const dailyBaseMinutes = getNumberEnv('AGENT_JORNADA_DAILY_MINUTES', 480);
          const nonWorking =
            !hasBatidas && /S[ÁA]BADO|DOMINGO|FERIADO|RECESSO|F[ÉE]RIAS|ATESTADO/i.test(observacao);
          if (hasBatidas) {
            funcionariosResumo[name].dias += 1;
            funcionariosResumo[name].minutos += dayMinutes;
            if (dayMinutes > dailyBaseMinutes) {
              funcionariosResumo[name].extras += dayMinutes - dailyBaseMinutes;
            }
          } else if (!nonWorking && hasObservacao) {
            funcionariosResumo[name].observacoes.push(`${dia}: ${observacao}`);
          }
          if (observacao) {
            const obsLabel = dia ? `${dia}: ${observacao}` : observacao;
            if (!funcionariosResumo[name].observacoes.includes(obsLabel)) {
              funcionariosResumo[name].observacoes.push(obsLabel);
            }
          }
        }

        if (jornadasDiarias.length === 0) return null;

        const mergeSimilarNames = () => {
          const normalizeKey = (value: string) =>
            normalizeHeader(value)
              .replace(/FUNCIONARIO|COLABORADOR|EMPREGADO|NOME/g, '')
              .trim();
          const allNames = new Set<string>();
          jornadasDiarias.forEach((item) => {
            if (item?.funcionario) allNames.add(String(item.funcionario));
          });
          Object.values(funcionariosResumo).forEach((item) => {
            if (item?.nome) allNames.add(String(item.nome));
          });
          const normalized = Array.from(allNames)
            .map((name) => ({ name, key: normalizeKey(name) }))
            .filter((item) => item.key && !isGenericNameLabel(item.name));
          if (normalized.length === 0) {
            return;
          }
          const sorted = [...normalized].sort((a, b) => b.key.length - a.key.length);
          const mapping = new Map<string, string>();
          normalized.forEach((item) => {
            let canonical = item.name;
            for (const candidate of sorted) {
              if (candidate.key.includes(item.key) || item.key.includes(candidate.key)) {
                canonical = candidate.name;
                break;
              }
            }
            mapping.set(item.name, canonical);
          });
          jornadasDiarias = jornadasDiarias.map((item) => {
            const canonical = mapping.get(String(item.funcionario)) || item.funcionario;
            return { ...item, funcionario: canonical };
          });
          const mergedResumo: typeof funcionariosResumo = {};
          Object.values(funcionariosResumo).forEach((item) => {
            const canonical = mapping.get(item.nome) || item.nome;
            if (!canonical) return;
            if (!mergedResumo[canonical]) {
              mergedResumo[canonical] = {
                ...item,
                nome: canonical,
                observacoes: [...item.observacoes]
              };
              return;
            }
            const current = mergedResumo[canonical];
            current.dias += item.dias;
            current.minutos += item.minutos;
            current.extras += item.extras;
            current.observacoes.push(...item.observacoes);
            current.observacoes = Array.from(new Set(current.observacoes));
          });
          Object.keys(funcionariosResumo).forEach((key) => {
            delete funcionariosResumo[key];
          });
          Object.assign(funcionariosResumo, mergedResumo);
        };

        mergeSimilarNames();

        const funcionarios = Object.values(funcionariosResumo).map((item) => {
          const horas = item.minutos;
          const hh = Math.floor(horas / 60);
          const mm = horas % 60;
          const extras = item.extras || 0;
          const ehh = Math.floor(extras / 60);
          const emm = extras % 60;
          return {
            nome: item.nome,
            diasTrabalhados: item.dias,
            horasTrabalhadas: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
            horasExtras: `${String(ehh).padStart(2, '0')}:${String(emm).padStart(2, '0')}`,
            atrasos: '',
            faltas: '',
            observacoes: item.observacoes.join(' | ')
          };
        });

        return {
          reportId: classification.reportId,
          documentoIndex: classification.documentoIndex,
          documentoNome: classification.documentoNome || 'Controle de Jornada',
          clienteId: classification.clientId,
          clienteNome: classification.clientName,
          regimeTributario: classification.regimeTributario,
          agenteProcessador: 'AGENTE_5_JORNADA',
          razaoSocial: classification.clientName || '',
          periodo: classification.periodoDetectado || '',
          jornadasDiarias,
          funcionarios,
          eventosDP: { ferias: [], desligamentos: [], admissoes: [], afastamentos: [] },
          alteracoesMes: {
            comparativo: { mesAnterior: '', valorAnterior: '', mesAtual: '', valorAtual: '', variacaoPercentual: '' },
            eventos: [],
            variaveis: [],
            observacoes: ''
          },
          observacoes: 'Extração a partir de CSV.',
          timestampProcessamento: new Date().toISOString(),
          temErro: false
        };
      };

      const buildEmptyJornadaOutput = (classification: ClassificationResult, reason: string) => ({
        reportId: classification.reportId,
        documentoIndex: classification.documentoIndex,
        documentoNome: classification.documentoNome || 'Controle de Jornada',
        clienteId: classification.clientId,
        clienteNome: classification.clientName,
        regimeTributario: classification.regimeTributario,
        agenteProcessador: 'AGENTE_5_JORNADA',
        razaoSocial: classification.clientName || '',
        periodo: classification.periodoDetectado || '',
        jornadasDiarias: [],
        funcionarios: [],
        eventosDP: { ferias: [], desligamentos: [], admissoes: [], afastamentos: [] },
        alteracoesMes: {
          comparativo: { mesAnterior: '', valorAnterior: '', mesAtual: '', valorAtual: '', variacaoPercentual: '' },
          eventos: [],
          variaveis: [],
          observacoes: ''
        },
        observacoes: reason,
        semDados: true,
        temErro: false,
        timestampProcessamento: new Date().toISOString()
      });

      const splitTextChunks = (text: string, maxChars: number) => {
        const chunks: string[] = [];
        let cursor = 0;
        while (cursor < text.length) {
          chunks.push(text.slice(cursor, cursor + maxChars));
          cursor += maxChars;
        }
        return chunks;
      };

      const buildChunkContents = (chunk: string, index: number, total: number) => [
        {
          role: 'user' as const,
          parts: [
            {
              text:
                `PARTE ${index + 1}/${total}. ` +
                'Extraia APENAS os dados visíveis nesta parte. ' +
                'Retorne JSON válido com jornadasDiarias e/ou funcionarios (campos ausentes vazios).'
            },
            { text: chunk }
          ]
        }
      ];

      const buildImageChunkContents = (
        page: { buffer: Buffer; mimeType: string; name: string },
        index: number,
        total: number
      ) => [
        {
          role: 'user' as const,
          parts: [
            {
              text:
                `PARTE ${index + 1}/${total}. ` +
                'Extraia APENAS os dados visíveis nesta parte da folha de ponto. ' +
                'Retorne JSON válido no schema do AGENTE_5 (campos ausentes podem ficar vazios).'
            },
            {
              inlineData: {
                mimeType: page.mimeType,
                data: page.buffer.toString('base64')
              }
            }
          ]
        }
      ];

      const normalizeLabel = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .trim();

      const parseJornadaFromText = (text: string, classification: ClassificationResult) => {
        if (!text || !text.trim()) return null;
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (lines.length === 0) return null;

        const normalizeName = (value: string) => {
          const cleaned = String(value || '')
            .replace(/^nome\\s*:?/i, '')
            .replace(/[^\\p{L}\\s.'-]/gu, '')
            .trim();
          if (!cleaned) return '';
          return cleaned
            .split(/\s+/)
            .map((part) => {
              if (part.length <= 2) return part.toUpperCase();
              return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            })
            .join(' ');
        };

        const daySequenceRaw: string[] = [];
        for (const line of lines) {
          if (/tra\.?\s*no/i.test(line)) break;
          if (/^\d{1,2}$/.test(line)) {
            daySequenceRaw.push(line.padStart(2, '0'));
            continue;
          }
          if (/^[0-9\s]+$/.test(line)) {
            const matches = line.match(/\b\d{1,2}\b/g);
            if (matches) {
              for (const match of matches) {
                daySequenceRaw.push(match.padStart(2, '0'));
              }
            }
          }
        }
        const hasDaySequence = daySequenceRaw.length >= 1;
        const daySequence = (() => {
          if (daySequenceRaw.length >= 10) {
            if (daySequenceRaw.length <= 24) {
              return daySequenceRaw;
            }
            for (let i = 0; i <= daySequenceRaw.length - 24; i += 1) {
              const window = daySequenceRaw.slice(i, i + 24);
              if (window[0] === '25' && window[window.length - 1] === '24') {
                return window;
              }
            }
            return daySequenceRaw.slice(0, 24);
          }
          return [];
        })();

        const labelSet = new Set([
          'SABADO',
          'DOMINGO',
          'FERIADO',
          'ATESTADO',
          'RECESSO',
          'FERIAS COLETIVAS',
          'FERIAS'
        ]);

        type Token = { type: 'time' | 'label'; value: string };
        const jornadasDiarias: any[] = [];
        const funcionariosResumo: Record<
          string,
          { nome: string; dias: number; minutos: number; observacoes: string[] }
        > = {};

        const toMinutes = (value: string) => {
          const [h, m] = value.split(':').map((v) => Number(v));
          return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
        };

        const calcHoras = (batidas: string[]) => {
          if (batidas.length >= 4) {
            return (
              Math.max(0, toMinutes(batidas[1]) - toMinutes(batidas[0])) +
              Math.max(0, toMinutes(batidas[3]) - toMinutes(batidas[2]))
            );
          }
          if (batidas.length >= 2) {
            return Math.max(0, toMinutes(batidas[1]) - toMinutes(batidas[0]));
          }
          return 0;
        };

        const buildTokens = (block: string[], startIndex: number) => {
          const tokens: Token[] = [];
          for (let i = startIndex; i < block.length; i += 1) {
            const raw = block[i];
            const norm = normalizeLabel(raw);
            if (!raw) continue;
            if (/^\\d{1,2}$/.test(raw)) {
              continue;
            }
            if (/^TRA\\.?\\s*NO/i.test(norm) || /^NOME$/i.test(norm) || /^DEPT/i.test(norm)) {
              continue;
            }
            if (norm === 'NOT SET' || norm === 'NOT SET1' || norm === 'NOT SET2') {
              continue;
            }
            if (norm === 'FERIAS' && block[i + 1]) {
              const nextNorm = normalizeLabel(block[i + 1]);
              if (nextNorm === 'COLETIVAS') {
                tokens.push({ type: 'label', value: 'FÉRIAS COLETIVAS' });
                i += 1;
                continue;
              }
            }
            if (labelSet.has(norm)) {
              tokens.push({ type: 'label', value: norm === 'FERIAS' ? 'FÉRIAS' : raw.toUpperCase() });
              continue;
            }
            const matches = raw.match(/\b\d{2}:\d{2}\b/g);
            if (matches) {
              for (const time of matches) {
                tokens.push({ type: 'time', value: time });
              }
            }
          }
          return tokens;
        };

        for (let idx = 0; idx < lines.length; idx += 1) {
          if (!/tra\.?\s*no/i.test(lines[idx])) continue;
          let name = '';
          let nameIndex = -1;
          for (let j = idx; j < Math.min(lines.length, idx + 12); j += 1) {
            if (/nome\\s*:?/i.test(lines[j])) {
              name = lines[j + 1] || lines[j].replace(/nome\\s*:?/i, '').trim();
              nameIndex = j + 2;
              break;
            }
          }
          if (!name) {
            for (let j = idx + 1; j < Math.min(lines.length, idx + 8); j += 1) {
              if (/^tra\\.?\\s*no/i.test(lines[j])) continue;
              if (/^nome\\b/i.test(lines[j])) continue;
              if (/^dept/i.test(lines[j])) continue;
              if (/^\d{1,2}$/.test(lines[j])) continue;
              if (lines[j]) {
                name = lines[j];
                nameIndex = j + 1;
                break;
              }
            }
          }
          name = normalizeName(name);
          if (!name || /^nome$/i.test(name)) {
            continue;
          }

          const nextMarker = lines.findIndex((line, pos) => pos > idx && /tra\.?\s*no/i.test(line));
          const blockEnd = nextMarker > idx ? nextMarker : lines.length;
          const block = lines.slice(idx, blockEnd);
          const tokens = buildTokens(block, Math.max(0, nameIndex - idx));
          if (tokens.length === 0) {
            continue;
          }

          let tokenIndex = 0;
          const effectiveDays =
            hasDaySequence && daySequence.length > 0
              ? daySequence
              : Array.from({ length: Math.max(1, Math.ceil(tokens.length / 4)) }, (_, i) =>
                  String(i + 1).padStart(2, '0')
                );
          for (let d = 0; d < effectiveDays.length; d += 1) {
            if (tokenIndex >= tokens.length) break;
            let batidas: string[] = [];
            let observacao = '';

            if (tokens[tokenIndex]?.type === 'label') {
              observacao = tokens[tokenIndex].value;
              tokenIndex += 1;
            } else {
              while (
                tokenIndex < tokens.length &&
                tokens[tokenIndex].type === 'time' &&
                batidas.length < 4
              ) {
                const current = tokens[tokenIndex].value;
                if (batidas.length > 0) {
                  const last = batidas[batidas.length - 1];
                  if (toMinutes(current) + 30 < toMinutes(last)) {
                    break;
                  }
                }
                batidas.push(current);
                tokenIndex += 1;
                if (batidas.length === 4) break;
              }
            }

            const filledBatidas = [...batidas];
            while (filledBatidas.length < 4) {
              filledBatidas.push('');
            }
            jornadasDiarias.push({
              funcionario: name,
              dia: effectiveDays[d],
              batidas: filledBatidas,
              observacao
            });

            if (!funcionariosResumo[name]) {
              funcionariosResumo[name] = { nome: name, dias: 0, minutos: 0, observacoes: [] };
            }
            if (batidas.length > 0 || observacao) {
              if (batidas.length > 0) {
                funcionariosResumo[name].dias += 1;
                funcionariosResumo[name].minutos += calcHoras(batidas);
              }
              if (observacao) {
                funcionariosResumo[name].observacoes.push(`${effectiveDays[d]}: ${observacao}`);
              }
            }
          }
        }

        if (jornadasDiarias.length === 0) {
          return null;
        }

        const funcionarios = Object.values(funcionariosResumo).map((item) => {
          const horas = item.minutos;
          const hh = Math.floor(horas / 60);
          const mm = horas % 60;
          return {
            nome: item.nome,
            diasTrabalhados: item.dias,
            horasTrabalhadas: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
            horasExtras: '',
            atrasos: '',
            faltas: '',
            observacoes: item.observacoes.join(' | ')
          };
        });

        const periodoMatch = text.match(/\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}/);
        const periodo = periodoMatch ? periodoMatch[0] : '';

        return {
          reportId: classification.reportId,
          documentoIndex: classification.documentoIndex,
          documentoNome: classification.documentoNome || 'Controle de Jornada',
          clienteId: classification.clientId,
          clienteNome: classification.clientName,
          regimeTributario: classification.regimeTributario,
          agenteProcessador: 'AGENTE_5_JORNADA',
          razaoSocial: classification.clientName || '',
          periodo,
          jornadasDiarias,
          funcionarios,
          eventosDP: { ferias: [], desligamentos: [], admissoes: [], afastamentos: [] },
          alteracoesMes: {
            comparativo: { mesAnterior: '', valorAnterior: '', mesAtual: '', valorAtual: '', variacaoPercentual: '' },
            eventos: [],
            variaveis: [],
            observacoes: ''
          },
          observacoes: 'Extração estruturada por análise de grade.',
          timestampProcessamento: new Date().toISOString(),
          temErro: false
        };
      };

      const buildCsvFromJornadas = (jornadas: any[]) => {
        if (!Array.isArray(jornadas) || jornadas.length === 0) return '';
        const header = [
          'funcionario',
          'dia',
          'batida_1',
          'batida_2',
          'batida_3',
          'batida_4',
          'observacao'
        ];
        const rows = jornadas.map((item) => {
          const batidas = Array.isArray(item?.batidas) ? item.batidas : [];
          const values = [
            item?.funcionario || '',
            item?.dia || '',
            batidas[0] || '',
            batidas[1] || '',
            batidas[2] || '',
            batidas[3] || '',
            item?.observacao || ''
          ];
          return values.map((value) => `"${String(value).replace(/\"/g, '""')}"`).join(',');
        });
        return [header.join(','), ...rows].join('\n');
      };

      const buildCsvContents = (csv: string) => [
        {
          role: 'user' as const,
          parts: [
            {
              text:
                'Você receberá um CSV com batidas de ponto. ' +
                'Use os dados do CSV para gerar o JSON no schema do AGENTE_5. ' +
                'Retorne APENAS JSON válido.\nCSV:\n' +
                csv
            }
          ]
        }
      ];

      const csvSystemInstruction =
        'Você é um agente de extração que recebe CSV de ponto. ' +
        'Transforme o CSV em JSON no schema do AGENTE_5. ' +
        'Retorne APENAS JSON válido.';

      const csvVisionInstruction =
        'Você recebe uma folha/cartão de ponto (PDF/Imagem). ' +
        'Faça ANÁLISE DE GRADE VISUAL: os dias ficam no cabeçalho da coluna e as batidas ficam diretamente abaixo. ' +
        'Associe corretamente cada batida ao dia acima, sem leitura linear. ' +
        'Cada funcionário ocupa um bloco separado de linhas; não misture horários entre blocos. ' +
        'Extraia a tabela de batidas e retorne APENAS CSV com o cabeçalho: ' +
        'funcionario,dia,batida_1,batida_2,batida_3,batida_4,observacao. ' +
        'Use vírgula como separador e aspas duplas quando necessário. ' +
        'Se o dia for SABADO/DOMINGO/FERIADO/ATESTADO/RECESSO/FÉRIAS COLETIVAS, ' +
        'preencha observacao e deixe as batidas vazias. ' +
        'Nunca escreva explicações fora do CSV.';

      const parseDayRanges = () => {
        const raw = (process.env.AGENT_JORNADA_DAY_RANGES || '').trim();
        if (!raw) {
          return [
            { start: 25, end: 31 },
            { start: 1, end: 6 },
            { start: 7, end: 12 },
            { start: 13, end: 18 },
            { start: 19, end: 24 }
          ];
        }
        return raw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const match = part.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
            if (!match) return null;
            return { start: Number(match[1]), end: Number(match[2]) };
          })
          .filter(Boolean) as Array<{ start: number; end: number }>;
      };

      const mergeCsvChunks = (chunks: string[]) => {
        const rows: string[] = [];
        let header = '';
        for (const chunk of chunks) {
          const cleaned = cleanCsvText(chunk);
          if (!cleaned) continue;
          const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (lines.length === 0) continue;
          const lineHeader = lines[0];
          if (!header && lineHeader.toLowerCase().includes('funcionario')) {
            header = lineHeader;
            rows.push(...lines.slice(1));
          } else {
            rows.push(...lines);
          }
        }
        if (!header && rows.length > 0) {
          header = 'funcionario,dia,batida_1,batida_2,batida_3,batida_4,observacao';
        }
        return header ? [header, ...rows].join('\n') : '';
      };

      const buildCsvFileContents = (doc: { fileUri?: string; mimeType?: string }) => [
        {
          role: 'user' as const,
          parts: [
            { text: csvVisionInstruction },
            {
              file_data: {
                file_uri: doc.fileUri,
                mime_type: doc.mimeType || 'application/pdf'
              }
            }
          ]
        }
      ];

      const extractCsvFromVision = async (
        classification: ClassificationResult,
        sourceDoc: { fileUri?: string; mimeType?: string }
      ) => {
        if (!sourceDoc?.fileUri) return '';
        const maxTokens = getNumberEnv('AGENT_PONTO_CSV_MAX_TOKENS', 6000);
        const attempt = async (instruction: string) => {
          try {
            const result = await runExtraction({
              systemInstruction: instruction,
              contents: buildCsvFileContents(sourceDoc),
              maxOutputTokens: maxTokens,
              responseMimeType: null
            });
            return cleanCsvText(result.text || '');
          } catch {
            return '';
          }
        };
        const hasRows = (value: string) => {
          const parsed = parseCsvToJornadas(value, classification);
          return parsed && Array.isArray(parsed.jornadasDiarias) && parsed.jornadasDiarias.length > 0;
        };

        let csv = await attempt(csvVisionInstruction);
        if (!csv || !hasRows(csv)) {
          csv = await attempt(`${csvVisionInstruction} Retorne somente CSV, sem explicações.`);
        }

        if (!csv || !hasRows(csv)) {
          const ranges = parseDayRanges();
          const chunkResults: string[] = [];
          for (const range of ranges) {
            const rangeLabel = `${String(range.start).padStart(2, '0')}-${String(range.end).padStart(2, '0')}`;
            const rangeInstruction =
              `${csvVisionInstruction} Extraia SOMENTE os dias ${range.start} a ${range.end} (inclusive). ` +
              `Não inclua dias fora do intervalo ${rangeLabel}.`;
            const chunkCsv = await attempt(rangeInstruction);
            if (chunkCsv) {
              chunkResults.push(chunkCsv);
            }
          }
          const merged = mergeCsvChunks(chunkResults);
          if (merged) {
            csv = merged;
          }
        }

        if (!csv) {
          logTask('agent_process_retry', `${classification.documentoNome} csv_empty`);
        }
        return csv;
      };
      const runAgente5ChunkFallback = async (classification: ClassificationResult) => {
        const sourceDoc =
          state.uploads.find((doc) => doc.fileUri === classification.file_uri) ||
          state.uploads.find((doc) => doc.documentoNome === classification.documentoNome);
        if (!sourceDoc?.buffer) {
          return null;
        }
        if (sourceDoc.mimeType === 'text/csv') {
          const csvText = sourceDoc.buffer.toString('utf8');
          const parsedCsv = parseCsvToJornadas(csvText, classification);
          return parsedCsv?.jornadasDiarias?.length ? parsedCsv : null;
        }
        const csvFromDocument = await extractCsvFromVision(classification, sourceDoc);
        if (!csvFromDocument) {
          return null;
        }
        const parsedCsv = parseCsvToJornadas(csvFromDocument, classification);
        return parsedCsv?.jornadasDiarias?.length ? parsedCsv : null;
      };

      const resolveJornadaCsv = async (classification: ClassificationResult) => {
        const sourceDoc =
          state.uploads.find((doc) => doc.fileUri === classification.file_uri) ||
          state.uploads.find((doc) => doc.documentoNome === classification.documentoNome);
        if (!sourceDoc) return null;
        if (sourceDoc.mimeType === 'text/csv' && sourceDoc.buffer) {
          const csvText = sourceDoc.buffer.toString('utf8');
          const parsedCsv = parseCsvToJornadas(csvText, classification);
          return parsedCsv?.jornadasDiarias?.length
            ? { csvText, parsed: parsedCsv, source: 'csv' }
            : null;
        }
        return null;
      };

      for (const classification of state.classifications) {
        const agent = typeConfig.routeAgent(classification.tipo);
        if (!agent) {
          outputs.push({
            agenteProcessador: 'DESCONHECIDO',
            ...classification
          });
          continue;
        }

        let effectiveClassification = classification;
        let contents = typeConfig.buildAgentContents(effectiveClassification, state.context);
        let systemInstruction = typeConfig.buildExtractionPrompt(agent, state.referenceContext);
        let csvFallback: any = null;

        if (agent === 'AGENTE_5') {
          const forceCsv = (process.env.AGENT_JORNADA_FORCE_CSV || 'false').toLowerCase() === 'true';
          const resolvedCsv = await resolveJornadaCsv(classification);
          if (resolvedCsv?.parsed) {
            logTask(
              'agent_process_info',
              `jornada_csv source=${resolvedCsv.source} rows=${resolvedCsv.parsed.jornadasDiarias.length} documento=${classification.documentoNome || 'documento'}`
            );
            if (forceCsv) {
              outputs.push(resolvedCsv.parsed);
              if (delayMs > 0) {
                await sleep(delayMs);
              }
              continue;
            }
            contents = buildCsvContents(resolvedCsv.csvText);
            systemInstruction = csvSystemInstruction;
            csvFallback = resolvedCsv.parsed;
          } else {
            logTask(
              'agent_process_info',
              `jornada_csv source=none documento=${classification.documentoNome || 'documento'}`
            );
          }
        }

        try {
          const maxTokens = agent === 'AGENTE_5' ? 2500 : undefined;
          const responseMimeType = agent === 'AGENTE_5' ? 'application/json' : undefined;
          const { text } = await runExtraction({
            systemInstruction,
            contents,
            maxOutputTokens: maxTokens,
            responseMimeType
          });
          if (!text || !text.trim()) {
            throw new Error('Resposta vazia do modelo');
          }
          let processed = processAgentResponse(agent, text, effectiveClassification);
          if (agent === 'AGENTE_5' && csvFallback && shouldFallbackJornada(processed)) {
            processed = csvFallback;
          }
          if (agent === 'AGENTE_5' && shouldFallbackJornada(processed)) {
            try {
              const ocrProcessed = await runAgente5ChunkFallback(classification);
              if (ocrProcessed) {
                processed = ocrProcessed;
              } else {
                const liteInstruction = typeConfig.buildExtractionPrompt('AGENTE_5_LITE', state.referenceContext);
                const { text: liteText } = await runExtraction({
                  systemInstruction: liteInstruction,
                  contents,
                  maxOutputTokens: 2000,
                  responseMimeType: null
                });
                if (liteText && liteText.trim()) {
                  processed = processAgentResponse('AGENTE_5', liteText, classification);
                }
              }
            } catch (fallbackError: any) {
              logTask('agent_process_retry', `${classification.documentoNome} chunk_fallback_failed ${fallbackError?.message || fallbackError}`);
            }
          }
          outputs.push(processed);
        } catch (error: any) {
          if (agent === 'AGENTE_5') {
            let ocrSucceeded = false;
            try {
              if (csvFallback) {
                outputs.push(csvFallback);
                ocrSucceeded = true;
              } else {
              const ocrProcessed = await runAgente5ChunkFallback(classification);
              if (ocrProcessed) {
                outputs.push(ocrProcessed);
                ocrSucceeded = true;
              }
              }
            } catch (ocrError: any) {
              logTask('agent_process_retry', `${classification.documentoNome} chunk_fallback_failed ${ocrError?.message || ocrError}`);
            }

            if (!ocrSucceeded) {
              if (csvFallback) {
                outputs.push(csvFallback);
                ocrSucceeded = true;
              }
            }

            if (!ocrSucceeded) {
              logTask('agent_process_retry', `${classification.documentoNome} retry_lite`);
              try {
                const liteInstruction = typeConfig.buildExtractionPrompt('AGENTE_5_LITE', state.referenceContext);
                const { text } = await runExtraction({
                  systemInstruction: liteInstruction,
                  contents,
                  maxOutputTokens: 2000,
                  responseMimeType: 'application/json'
                });
                if (!text || !text.trim()) {
                  throw new Error('Resposta vazia do modelo (lite)');
                }
                const processed = processAgentResponse('AGENTE_5', text, classification);
                outputs.push(processed);
                ocrSucceeded = true;
              } catch (retryError: any) {
                logTask('agent_process_error', `${classification.documentoNome} ${retryError?.message || retryError}`);
              }
            }
            if (!ocrSucceeded) {
              outputs.push(
                buildEmptyJornadaOutput(
                  classification,
                  'Falha ao extrair jornada; documento marcado como sem dados.'
                )
              );
            }
          } else {
            logTask('agent_process_error', `${classification.documentoNome} ${error?.message || error}`);
            outputs.push({
              agenteProcessador: mapAgentProcessador(agent),
              erro: error?.message || String(error),
              ...classification
            });
          }
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      // Retry interno para jornada (AGENTE_5) quando ainda houver erros.
      const failedJornada = outputs.filter(
        (item) =>
          item &&
          item.agenteProcessador === 'AGENTE_5_JORNADA' &&
          (item.erro || item.temErro)
      );
      if (failedJornada.length > 0) {
        logTask('agent_process_retry', `jornada_retry docs=${failedJornada.length}`);
        for (const failed of failedJornada) {
          const classification = state.classifications.find((item) => {
            if (failed.documentoIndex != null && item.documentoIndex != null) {
              return String(failed.documentoIndex) === String(item.documentoIndex);
            }
            return item.documentoNome === failed.documentoNome;
          });
          if (!classification) continue;
          try {
          const retried = await runAgente5ChunkFallback(classification);
            if (retried) {
              const idx = outputs.findIndex(
                (item) => item && item.documentoIndex === retried.documentoIndex
              );
              if (idx >= 0) {
                outputs[idx] = retried;
              } else {
                outputs.push(retried);
              }
            }
          } catch (retryError: any) {
            logTask('agent_process_retry', `${classification.documentoNome} chunk_retry_failed ${retryError?.message || retryError}`);
          }
        }
      }

      logTask('workflow_extracao', `itens=${outputs.length}`);
      return { extractions: outputs };
    }
  });

  const consolidateNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      let consolidated = null;
      try {
        const validExtractions = (state.extractions || []).filter(
          (item) => item && !item.erro && item.temErro !== true
        );
        consolidated = consolidarDados(validExtractions, { calcularAliquotaProgressiva });
      } catch (error: any) {
        logTask('workflow_consolidar_erro', error?.message || String(error));
      }

      return { consolidated };
    }
  });

  const calcNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const enableCalc = (process.env.AGENT_CALC_WITH_CODE_EXECUTION || 'false').toLowerCase() === 'true';
      if (!enableCalc || !state.consolidated) {
        return { calc: null };
      }

      const tipoParecer = String(state.request?.tipoParecer || '').toLowerCase();
      if (tipoParecer === 'pessoal') {
        logTask('workflow_calc_skip', 'parecer pessoal usa secoes diretas (sem calc)');
        return { calc: null };
      }
      const typeConfig = resolveWorkflowConfig(tipoParecer);

      const apiKey = readEnvOrFile('GEMINI_API_KEY', logTask);
      if (!apiKey) {
        logTask('workflow_calc_skip', 'GEMINI_API_KEY ausente');
        return { calc: null };
      }

      const model = process.env.GEMINI_CALC_MODEL || 'gemini-2.5-pro';
      const uploadResumo = (state.uploads || []).map((doc) => ({
        documentoNome: doc.documentoNome,
        documentoTipo: doc.documentoTipo,
        mimeType: doc.mimeType
      }));
      const classificacoesResumo = (state.classifications || []).map((item) => ({
        documentoNome: item.documentoNome,
        tipo: item.tipo,
        formato: item.formato,
        periodoDetectado: item.periodoDetectado,
        cnpjDetectado: item.cnpjDetectado
      }));
      const payload = typeConfig.buildPayload(state, classificacoesResumo, uploadResumo);

      const systemInstruction = typeConfig.systemInstruction;
      const outputSchema = typeConfig.outputSchema;
      const tipoParecerFinal = tipoParecer || typeConfig.id;
      const relatorioType = String(state.request?.categoria || '').toLowerCase();

      const enrichCabecalho = (calcObj: any) => {
        if (!calcObj || typeof calcObj !== 'object') return;
        const cab = calcObj.dadosCabecalho || {};
        if (!cab.tipo_parecer) {
          cab.tipo_parecer = tipoParecerFinal;
        }
        if (relatorioType && !cab.relatorio_type) {
          cab.relatorio_type = relatorioType;
        }
        calcObj.dadosCabecalho = cab;
      };

      const outputSchemaObject = (() => {
        try {
          return JSON.parse(outputSchema);
        } catch (error: any) {
          logTask('workflow_calc_schema_error', error?.message || String(error));
          return null;
        }
      })();

      const contents = [
        {
          role: 'user' as const,
          parts: [
            {
              text:
                typeConfig.promptIntro +
                'SCHEMA:\n' +
                outputSchema +
                '\n\nINPUT:\n' +
                JSON.stringify(payload)
            }
          ]
        }
      ];

      const attempts = [
        {
          label: 'json',
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json'
          }
        },
        {
          label: 'retry-text',
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 2000
          },
          extraInstruction:
            'Retorne obrigatoriamente um JSON válido. Se algum campo não puder ser calculado, use valor 0 e formatado "0,00".'
        }
      ];

      let lastError: any = null;
      let lastText: string | null = null;
      for (const attempt of attempts) {
        try {
          const retryInstruction = attempt.extraInstruction
            ? `${systemInstruction}\n\n${attempt.extraInstruction}`
            : systemInstruction;

          const { text } = await callGeminiGenerateContent(
            {
              apiKey,
              model,
              systemInstruction: retryInstruction,
              contents,
              generationConfig: attempt.generationConfig,
              forceDisableTools: !typeConfig.allowCodeExecution
            },
            logTask
          );

          const clean = cleanJson(text);
          lastText = clean || text;
          if (!clean || !clean.trim()) {
            throw new Error('Resposta vazia do Gemini');
          }
          const calc = JSON.parse(clean);
          enrichCabecalho(calc);
          if (typeConfig.isSchemaValid(calc)) {
            return { calc };
          }
          lastError = new Error('Schema incompleto no calc');
        } catch (error: any) {
          lastError = error;
          logTask('workflow_calc_retry', `${attempt.label} ${error?.message || String(error)}`);
        }
      }

      // Estruturador: segunda chamada do Gemini para formatar a saída final.
      try {
        const { text } = await callGeminiGenerateContent(
          {
            apiKey,
            model,
            systemInstruction:
              'Voce e um estruturador de saidas. Retorne somente JSON valido no schema indicado.',
            contents: [
              {
                role: 'user' as const,
                parts: [
                  {
                    text:
                      'Estruture a saida no schema abaixo usando o CALC (se houver) e o CONSOLIDADO.\n\n' +
                      'SCHEMA:\n' +
                      outputSchema +
                      '\n\nCALC:\n' +
                      (lastText || '') +
                      '\n\nCONSOLIDADO:\n' +
                      JSON.stringify(payload)
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.0,
              maxOutputTokens: 3000
              },
              forceDisableTools: !typeConfig.allowCodeExecution
            },
            logTask
          );

          const clean = cleanJson(text);
          const calc = JSON.parse(clean);
          enrichCabecalho(calc);
          if (typeConfig.isSchemaValid(calc)) {
            logTask('workflow_calc_structured', 'ok');
            return { calc };
          }
      } catch (error: any) {
        logTask('workflow_calc_structured_error', error?.message || String(error));
      }

      const sectionedEnabled = (process.env.AGENT_CALC_SECTIONED || 'true').toLowerCase() !== 'false';
      if (sectionedEnabled && outputSchemaObject) {
        const sectionMaxTokens = getNumberEnv('AGENT_CALC_SECTION_MAX_TOKENS', 1200);
        const sectionRetries = getNumberEnv('AGENT_CALC_SECTION_RETRIES', 1);
        const baseDefaults = JSON.parse(JSON.stringify(outputSchemaObject));
        const baseFromConsolidado = typeConfig.buildBaseFromConsolidado(state) || {};
        const sectionKeys = typeConfig.sectionKeys;

        const mergedBase: any = {
          ...baseDefaults,
          ...baseFromConsolidado,
          tipo: typeConfig.rootTipo
        };

        for (const key of sectionKeys) {
          const defaultsSection = (baseDefaults as any)[key];
          const baseSection = (baseFromConsolidado as any)[key];
          if (defaultsSection || baseSection) {
            (mergedBase as any)[key] = {
              ...(defaultsSection || {}),
              ...(baseSection || {})
            };
          }
        }

        const sectionSpecs = sectionKeys.map((key) => ({
          key,
          schema: JSON.stringify({ [key]: (baseDefaults as any)[key] ?? {} })
        }));

        const buildSectionContents = (spec: { key: string; schema: string }) => [
          {
            role: 'user' as const,
            parts: [
              {
                text:
                  `Gere apenas a seção ${spec.key} do parecer. ` +
                  'Retorne APENAS JSON válido com essa chave.\n\n' +
                  'SCHEMA:\n' +
                  spec.schema +
                  '\n\nINPUT:\n' +
                  JSON.stringify(payload)
              }
            ]
          }
        ];

        for (const spec of sectionSpecs) {
          let sectionOk = false;
          let sectionError: any = null;
          for (let attempt = 1; attempt <= sectionRetries + 1; attempt += 1) {
            try {
              const { text } = await callGeminiGenerateContent(
                {
                  apiKey,
                  model,
                  systemInstruction:
                    systemInstruction +
                    '\nRetorne somente o JSON dessa seção. Se algum campo não puder ser calculado, use valores 0.',
                  contents: buildSectionContents(spec),
                  generationConfig: {
                    temperature: 0.0,
                    maxOutputTokens: sectionMaxTokens,
                    responseMimeType: 'application/json'
                  },
                  forceDisableTools: !typeConfig.allowCodeExecution
                },
                logTask
              );
              const clean = cleanJson(text);
              if (!clean || !clean.trim()) {
                throw new Error('Resposta vazia do Gemini');
              }
              const parsed = JSON.parse(clean);
              if (parsed && typeof parsed === 'object' && parsed[spec.key]) {
                mergedBase[spec.key] = parsed[spec.key];
                sectionOk = true;
                logTask('workflow_calc_section_ok', spec.key);
                break;
              }
              sectionError = new Error('Seção ausente no JSON');
            } catch (error: any) {
              sectionError = error;
              logTask(
                'workflow_calc_section_retry',
                `${spec.key} attempt=${attempt} ${error?.message || String(error)}`
              );
            }
          }
          if (!sectionOk) {
            logTask('workflow_calc_section_fail', `${spec.key} ${sectionError?.message || 'erro'}`);
          }
        }

        enrichCabecalho(mergedBase);
        if (typeConfig.isSchemaValid(mergedBase)) {
          logTask('workflow_calc_sectioned', 'ok');
          return { calc: mergedBase };
        }
      }

      logTask('workflow_calc_erro', lastError?.message || String(lastError));
      const fallback = typeConfig.buildFallback(state);
      if (fallback) {
        enrichCabecalho(fallback);
        logTask('workflow_calc_fallback', 'usando calculo local');
        return { calc: fallback };
      }
      return { calc: { error: lastError?.message || String(lastError) } };
    }
  });

  const formatNode = new RunnableLambda({
    func: async (state: WorkflowState) => {
      const resumo = buildResumo(state.classifications, state.extractions);
      const responsePayload = {
        requestId: state.context?.requestId,
        reportId: state.context?.reportId,
        cliente: {
          id: state.context?.clientId,
          nome: state.context?.clientName,
          regimeTributario: state.context?.regimeTributario,
          categoria: state.context?.categoria
        },
        uploads: state.uploads.map((doc) => ({
          documentoIndex: doc.documentoIndex,
          documentoNome: doc.documentoNome,
          mimeType: doc.mimeType,
          fileUri: doc.fileUri,
          state: doc.state
        })),
        classificacoes: state.classifications,
        resultados: state.extractions,
        consolidado: state.consolidated,
        calculosIA: state.calc,
        resumo
      };

      const response = JSON.stringify(responsePayload, null, 2);
      return { response };
    }
  });

  return {
    invoke: async (input: { request: AgentRequest }) => {
      const state: WorkflowState = {
        request: input.request,
        context: null,
        normalizedDocs: [],
        uploads: [],
        classifications: [],
        extractions: [],
        consolidated: null,
        calc: null,
        referenceContext: '',
        response: '',
        errors: []
      };

      Object.assign(state, await normalizeNode.invoke(state));
      Object.assign(state, await uploadNode.invoke(state));
      Object.assign(state, await classifyNode.invoke(state));
      Object.assign(state, await extractNode.invoke(state));
      Object.assign(state, await consolidateNode.invoke(state));
      Object.assign(state, await calcNode.invoke(state));
      Object.assign(state, await formatNode.invoke(state));

      return state;
    }
  };
}


async function loadReferenceContext(logTask: (task: string, detail?: string) => void, request?: AgentRequest) {
  const envInclude = (process.env.AGENT_INCLUDE_REFERENCES || 'true').toLowerCase() === 'true';
  const requestInclude = typeof request?.includeReferences === 'boolean' ? request.includeReferences : undefined;
  const includeReferences = requestInclude ?? envInclude;
  if (!includeReferences) {
    return '';
  }

  const referencesDir =
    (process.env.AGENT_REFERENCES_DIR || '').trim() || path.join(process.cwd(), 'references');
  const maxRefChars = parseInt(process.env.AGENT_REF_MAX_CHARS || '140000', 10);
  const envAllowList = (process.env.AGENT_REFERENCE_FILES || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const requestAllowList = Array.isArray(request?.referenceFiles)
    ? request?.referenceFiles.map((f) => String(f).trim()).filter(Boolean)
    : [];

  const tipoParecer = String(request?.tipoParecer || '').toLowerCase();
  let finalAllowList: string[] | undefined = undefined;

  if (requestAllowList.length > 0) {
    finalAllowList = requestAllowList;
  } else if (envAllowList.length > 0) {
    finalAllowList = envAllowList;
  }

  if (!finalAllowList || finalAllowList.length === 0) {
    logTask('referencias_filtradas', 'nenhuma');
    return '';
  }

  const references = await loadReferences(
    referencesDir,
    maxRefChars,
    logTask,
    finalAllowList
  );

  logTask('referencias_carregadas', `count=${references.files.length} chars=${references.merged.length}`);
  return references.merged || '';
}

function normalizeDocuments(request: AgentRequest, context: WorkflowContext): NormalizedDocument[] {
  const docs = Array.isArray(request.documents) ? request.documents : [];
  const totalDocumentos = docs.length;

  return docs.map((doc: any, index: number) => {
    const documentoIndex = Number.isFinite(doc?.documentoIndex)
      ? Number(doc.documentoIndex)
      : Number.isFinite(doc?.index)
        ? Number(doc.index)
        : index;

    const documentoNome = doc?.name || doc?.documentoNome || `Documento_${index + 1}`;
    const rawContent =
      (typeof doc?.content === 'string' && doc.content) ||
      (typeof doc?.base64Content === 'string' && doc.base64Content) ||
      (typeof doc?.base64 === 'string' && doc.base64) ||
      '';
    const content = rawContent.trim();
    const inputFormat = detectInputFormat(content);
    let normalizedText: string | undefined;
    let buffer: Buffer | undefined;
    let mimeType =
      doc?.mimeType ||
      doc?.mime_type ||
      doc?.type ||
      (inputFormat === 'json'
        ? 'application/json'
        : inputFormat === 'csv'
          ? 'text/csv'
          : inputFormat === 'text'
            ? 'text/plain'
            : inferMimeType(rawContent)) ||
      'application/pdf';

    if (content) {
      if (inputFormat === 'base64') {
        buffer = decodeBase64(content);
      } else {
        normalizedText = normalizeTextContent(content, inputFormat);
        buffer = Buffer.from(normalizedText, 'utf8');
      }
    }

    const rawSize = doc?.size ?? doc?.contentSize ?? (buffer ? buffer.length : 0);
    const size = Number.isFinite(Number(rawSize)) ? Number(rawSize) : buffer ? buffer.length : 0;

    return {
      index,
      documentoIndex,
      documentoNome,
      documentoTipo: doc?.documentoTipo,
      fileUri: doc?.file_uri || doc?.fileUri,
      mimeType,
      buffer,
      inputFormat,
      normalizedText,
      size,
      totalDocumentos,
      reportId: context.reportId,
      clientId: context.clientId,
      clientName: context.clientName,
      regimeTributario: context.regimeTributario
    };
  });
}

function processClassification(rawText: string, doc: UploadedDocument, context: WorkflowContext | null): ClassificationResult {
  const cleanText = cleanJson(rawText);
  let classificacao: any;

  try {
    classificacao = JSON.parse(cleanText);
    if (!classificacao.tipo || !classificacao.formato) {
      throw new Error('Classificação incompleta');
    }
  } catch (error: any) {
    classificacao = {
      tipo: 'DESCONHECIDO',
      formato: 'PDF_ESTRUTURADO',
      confianca: 0,
      indicadoresEncontrados: [],
      observacao: `Erro: ${error?.message || 'parse_error'}`,
      cnpjDetectado: null,
      periodoDetectado: null
    };
  }

  const statusMap: Record<string, string> = {
    PGDAS_PDF: 'pgdas',
    PGDAS_XML: 'pgdas',
    EXTRATO_BANCARIO: 'extrato_financeiro',
    EXTRATO_CARTAO: 'extrato_financeiro',
    FOLHA_PAGAMENTO: 'folha',
    PONTO_JORNADA: 'jornada',
    NFSE_PDF: 'nota_fiscal',
    NFSE_XML: 'nota_fiscal',
    NFE_XML: 'nota_fiscal',
    CTE_XML: 'nota_fiscal',
    RELATORIO_VENDAS: 'outros',
    DESCONHECIDO: 'desconhecido'
  };

  const confiancaMinima = 0.7;
  const precisaRevisao = Number(classificacao.confianca || 0) < confiancaMinima;

  return {
    reportId: context?.reportId,
    documentoIndex: doc.documentoIndex,
    documentoNome: doc.documentoNome,
    clientId: context?.clientId,
    clientName: context?.clientName,
    regimeTributario: context?.regimeTributario,
    file_uri: doc.fileUri,
    mime_type: doc.mimeType,
    state: doc.state,
    tipo: classificacao.tipo || 'DESCONHECIDO',
    tipoCategoria: statusMap[classificacao.tipo] || 'desconhecido',
    formato: classificacao.formato || 'PDF_ESTRUTURADO',
    confianca: Number(classificacao.confianca || 0),
    precisaRevisao,
    indicadoresEncontrados: classificacao.indicadoresEncontrados || [],
    observacao: classificacao.observacao || '',
    cnpjDetectado: classificacao.cnpjDetectado || null,
    periodoDetectado: classificacao.periodoDetectado || null,
    totalDocumentos: doc.totalDocumentos,
    timestamp: new Date().toISOString(),
    _debug: {
      respostaOriginal: rawText,
      classificacaoCompleta: classificacao
    }
  };
}

function processAgentResponse(agent: string, rawText: string, classification: ClassificationResult) {
  switch (agent) {
    case 'AGENTE_1':
      return processAgent1(rawText, classification);
    case 'AGENTE_2':
      return processAgent2(rawText, classification);
    case 'AGENTE_3':
      return processAgent3(rawText, classification);
    case 'AGENTE_4':
      return processAgent4(rawText, classification);
    case 'AGENTE_5':
      return processAgent5(rawText, classification);
    default:
      return { agenteProcessador: 'DESCONHECIDO', ...classification };
  }
}

function mapAgentProcessador(agent: string) {
  switch (agent) {
    case 'AGENTE_1':
      return 'AGENTE_1_EXTRATOS';
    case 'AGENTE_2':
      return 'AGENTE_2_PGDAS';
    case 'AGENTE_3':
      return 'AGENTE_3_FOLHA';
    case 'AGENTE_4':
      return 'AGENTE_4_NOTAS';
    case 'AGENTE_5':
      return 'AGENTE_5_JORNADA';
    default:
      return 'DESCONHECIDO';
  }
}

function buildIntegridade(agent: string, dados: any) {
  const erros: string[] = [];
  const avisos: string[] = [];

  const hasValue = (value: any) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  };

  const validatePeriodo = (periodo: any) => {
    if (!hasValue(periodo)) return;
    const raw = String(periodo).trim();
    if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(raw)) {
      avisos.push(`Período em formato inesperado: "${raw}".`);
    }
  };

  if (agent === 'AGENTE_1') {
    if (!hasValue(dados?.periodo)) erros.push('Período não informado no extrato.');
    if (!hasValue(dados?.totalMovimentoReal)) erros.push('Total de movimento real ausente no extrato.');
    if (!hasValue(dados?.cnpj)) avisos.push('CNPJ não identificado no extrato.');
    validatePeriodo(dados?.periodo);
  }

  if (agent === 'AGENTE_2') {
    if (!hasValue(dados?.periodo)) erros.push('Período não informado no PGDAS.');
    if (!hasValue(dados?.valorDAS) && !hasValue(dados?.impostoCalculado)) {
      erros.push('Valor do DAS/imposto não informado no PGDAS.');
    }
    if (!hasValue(dados?.cnpj)) avisos.push('CNPJ não identificado no PGDAS.');
    validatePeriodo(dados?.periodo);
  }

  if (agent === 'AGENTE_3') {
    if (!hasValue(dados?.periodo)) avisos.push('Período não identificado na folha.');
    if (!hasValue(dados?.totalSalarioBruto)) avisos.push('Total salário bruto não informado na folha.');
    validatePeriodo(dados?.periodo);
  }

  if (agent === 'AGENTE_4') {
    if (!hasValue(dados?.tipoNota)) avisos.push('Tipo de nota não identificado.');
    if (!hasValue(dados?.periodo)) avisos.push('Período não identificado nas notas.');
    validatePeriodo(dados?.periodo);
  }

  if (agent === 'AGENTE_5') {
    const jornadas = Array.isArray(dados?.jornadasDiarias) ? dados.jornadasDiarias : [];
    const funcionarios = Array.isArray(dados?.funcionarios) ? dados.funcionarios : [];
    if (jornadas.length === 0 && funcionarios.length === 0) {
      avisos.push('Sem jornadas/funcionários consolidados no controle de jornada.');
    }
    if (hasValue(dados?.periodo)) {
      validatePeriodo(dados?.periodo);
    }
  }

  return { erros, avisos, ok: erros.length === 0 };
}

function processAgent1(rawText: string, classification: ClassificationResult) {
  const cleanText = cleanJson(rawText);
  let dadosExtraidos: any;
  try {
    dadosExtraidos = JSON.parse(cleanText);
    if (!dadosExtraidos.totalMovimentoReal) {
      throw new Error('Resposta incompleta - falta totalMovimentoReal');
    }
  } catch (error: any) {
    dadosExtraidos = {
      cnpj: classification.cnpjDetectado,
      periodo: classification.periodoDetectado,
      banco: 'Não identificado',
      vendasCartao: {
        stone: '0,00',
        cielo: '0,00',
        pagBank: '0,00',
        rede: '0,00',
        getnet: '0,00',
        mercadoPago: '0,00',
        outras: '0,00',
        total: '0,00'
      },
      pix: { total: '0,00', quantidade: 0 },
      depositos: { total: '0,00', quantidade: 0 },
      transferenciasRecebidas: { total: '0,00', quantidade: 0, detalhes: '' },
      transferenciasEntreCnpjs: { total: '0,00', quantidade: 0, detalhes: '' },
      totalMovimentoReal: '0,00',
      observacoes: `Erro: ${error?.message || 'parse_error'}`,
      _erro: true
    };
  }

  const parseValorBR = (valor: string) => {
    if (!valor || valor === '0,00') return 0;
    return parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  };

  const totalCartao = parseValorBR(dadosExtraidos.vendasCartao?.total);
  const totalPix = parseValorBR(dadosExtraidos.pix?.total);
  const totalDepositos = parseValorBR(dadosExtraidos.depositos?.total);
  const totalTransfRecebidas = parseValorBR(dadosExtraidos.transferenciasRecebidas?.total);
  const totalTransfEntreCnpjs = parseValorBR(dadosExtraidos.transferenciasEntreCnpjs?.total);

  const movimentoCalculado = totalCartao + totalPix + totalDepositos + totalTransfRecebidas - totalTransfEntreCnpjs;
  const movimentoInformado = parseValorBR(dadosExtraidos.totalMovimentoReal);
  const diferenca = Math.abs(movimentoCalculado - movimentoInformado);
  const integridade = buildIntegridade('AGENTE_1', dadosExtraidos);

  return {
    reportId: classification.reportId,
    documentoIndex: classification.documentoIndex,
    documentoNome: classification.documentoNome,
    clienteId: classification.clientId,
    clienteNome: classification.clientName,
    regimeTributario: classification.regimeTributario,
    agenteProcessador: 'AGENTE_1_EXTRATOS',
    cnpj: dadosExtraidos.cnpj,
    razaoSocial: dadosExtraidos.razaoSocial,
    confiancaClassificacao: classification.confianca,
    ...dadosExtraidos,
    validacao: {
      movimentoCalculado: movimentoCalculado.toFixed(2).replace('.', ','),
      movimentoInformado: dadosExtraidos.totalMovimentoReal,
      diferencaAbsoluta: diferenca.toFixed(2),
      calculoCorreto: diferenca < 0.01,
      detalhamento: {
        vendasCartao: totalCartao.toFixed(2),
        pix: totalPix.toFixed(2),
        depositos: totalDepositos.toFixed(2),
        transferenciasRecebidas: totalTransfRecebidas.toFixed(2),
        transferenciasEntreCnpjs: totalTransfEntreCnpjs.toFixed(2)
      }
    },
    integridade,
    timestampProcessamento: new Date().toISOString(),
    temErro: dadosExtraidos._erro || false,
    _debug: {
      respostaOriginal: rawText.substring(0, 500),
      file_uri: classification.file_uri
    }
  };
}

function processAgent2(rawText: string, classification: ClassificationResult) {
  const cleanText = cleanJson(rawText);
  let dadosExtraidos: any;

  try {
    dadosExtraidos = JSON.parse(cleanText);
    if (!dadosExtraidos.razaoSocial || !dadosExtraidos.cnpj) {
      throw new Error('Resposta incompleta - faltam dados básicos');
    }
  } catch (error: any) {
    dadosExtraidos = {
      razaoSocial: classification.clientName || 'Não identificado',
      cnpj: classification.cnpjDetectado || '00.000.000/0000-00',
      periodo: classification.periodoDetectado || '00/0000',
      receitaBrutaMes: '0,00',
      receitaBrutaAcumulada: '0,00',
      aliquota: '0,00',
      valorDAS: '0,00',
      anexo: null,
      aplicouFatorR: false,
      dataVencimentoDAS: null,
      comprasMes: '0,00',
      comprasAcumuladas: '0,00',
      somenteGuia: true,
      receitasMensaisAnoCorrente: [],
      folhasMensais: [],
      estabelecimentos: [],
      observacoes: `Erro no processamento: ${error?.message || 'parse_error'}`,
      _erro: true
    };
  }

  if (!dadosExtraidos.receitasMensaisAnoCorrente) {
    dadosExtraidos.receitasMensaisAnoCorrente = [];
  }
  if (!dadosExtraidos.folhasMensais) {
    dadosExtraidos.folhasMensais = [];
  }
  if (!dadosExtraidos.estabelecimentos) {
    dadosExtraidos.estabelecimentos = [];
  }

  if (!dadosExtraidos.impostosMensais) {
    dadosExtraidos.impostosMensais = [
      {
        mes: dadosExtraidos.periodo,
        valor: dadosExtraidos.valorDAS
      }
    ];
  } else {
    const mesAtualNoArray = dadosExtraidos.impostosMensais.some((i: any) => i.mes === dadosExtraidos.periodo);
    if (!mesAtualNoArray) {
      dadosExtraidos.impostosMensais.push({
        mes: dadosExtraidos.periodo,
        valor: dadosExtraidos.valorDAS
      });
      dadosExtraidos.impostosMensais.sort((a: any, b: any) => {
        const [mesA, anoA] = String(a.mes).split('/').map(Number);
        const [mesB, anoB] = String(b.mes).split('/').map(Number);
        return anoA * 12 + mesA - (anoB * 12 + mesB);
      });
    }
  }

  const integridade = buildIntegridade('AGENTE_2', dadosExtraidos);

  return {
    reportId: classification.reportId,
    documentoIndex: classification.documentoIndex,
    documentoNome: classification.documentoNome,
    clienteId: classification.clientId,
    clienteNome: classification.clientName,
    regimeTributario: classification.regimeTributario,
    agenteProcessador: 'AGENTE_2_PGDAS',
    confiancaClassificacao: classification.confianca,
    razaoSocial: dadosExtraidos.razaoSocial,
    cnpj: dadosExtraidos.cnpj,
    periodo: dadosExtraidos.periodo,
    receitaBrutaMes: dadosExtraidos.receitaBrutaMes,
    receitaBrutaAcumulada: dadosExtraidos.receitaBrutaAcumulada,
    aliquota: dadosExtraidos.aliquota,
    valorDAS: dadosExtraidos.valorDAS,
    anexo: dadosExtraidos.anexo,
    aplicouFatorR: dadosExtraidos.aplicouFatorR,
    dataVencimentoDAS: dadosExtraidos.dataVencimentoDAS,
    comprasMes: dadosExtraidos.comprasMes,
    comprasAcumuladas: dadosExtraidos.comprasAcumuladas,
    somenteGuia: dadosExtraidos.somenteGuia,
    receitasMensaisAnoCorrente: dadosExtraidos.receitasMensaisAnoCorrente,
    folhasMensais: dadosExtraidos.folhasMensais,
    impostosMensais: dadosExtraidos.impostosMensais,
    estabelecimentos: dadosExtraidos.estabelecimentos,
    observacoes: dadosExtraidos.observacoes,
    integridade,
    timestampProcessamento: new Date().toISOString(),
    temErro: dadosExtraidos._erro || false,
    _debug: {
      respostaOriginal: rawText.substring(0, 800),
      file_uri: classification.file_uri,
      historicoExtraido: {
        receitas: dadosExtraidos.receitasMensaisAnoCorrente.length > 0,
        folhas: dadosExtraidos.folhasMensais.length > 0,
        impostos: dadosExtraidos.impostosMensais.length > 0,
        estabelecimentos: dadosExtraidos.estabelecimentos.length > 0
      }
    }
  };
}

function processAgent3(rawText: string, classification: ClassificationResult) {
  const cleanText = cleanJson(rawText);
  let dados: any;
  try {
    dados = JSON.parse(cleanText);
  } catch (error: any) {
    throw new Error(`Erro ao parsear JSON do Agente 3: ${error?.message || 'parse_error'}`);
  }
  const integridade = buildIntegridade('AGENTE_3', dados);

  const dadosOriginais = {
    reportId: classification.reportId,
    documentoIndex: classification.documentoIndex,
    documentoNome: classification.documentoNome || 'Folha de Pagamento',
    clienteId: classification.clientId,
    clienteNome: classification.clientName,
    regimeTributario: classification.regimeTributario
  };

  return {
    ...dadosOriginais,
    agenteProcessador: 'AGENTE_3_FOLHA',
    ...dados,
    integridade,
    timestampProcessamento: new Date().toISOString(),
    temErro: false
  };
}

function processAgent4(rawText: string, classification: ClassificationResult) {
  const cleanText = cleanJson(rawText);
  let dados: any;
  try {
    dados = JSON.parse(cleanText);
  } catch (error: any) {
    throw new Error(`Erro ao parsear JSON do Agente 4: ${error?.message || 'parse_error'}`);
  }
  const integridade = buildIntegridade('AGENTE_4', dados);

  const parseFloatBR = (valor: any) => {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(String(valor).replace(/\./g, '').replace(',', '.')) || 0;
  };

  const formatarValorBR = (valor: number) =>
    valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let totalCompras = 0;
  const itensCompras: Array<{ codigo: string; descricao: string; valor: string }> = [];

  const isCompraEntrada = (descricao: string) => {
    if (!descricao) return false;
    if (descricao.includes('COMPRA')) return true;

    const hasServico = descricao.includes('SERV');
    if (!hasServico) return false;

    if (descricao.includes('PREST')) return false;

    return (
      descricao.includes('TOMAD') ||
      descricao.includes('ADQ') ||
      descricao.includes('ADQUIR') ||
      descricao.includes('CONTRAT')
    );
  };

  if (dados.entradas && Array.isArray(dados.entradas)) {
    for (const entrada of dados.entradas) {
      const descricao = String(entrada.descricao || '').toUpperCase();
      const valor = parseFloatBR(entrada.valor);
      if (isCompraEntrada(descricao)) {
        totalCompras += valor;
        itensCompras.push({
          codigo: entrada.codigo,
          descricao: entrada.descricao,
          valor: entrada.valor
        });
      }
    }
  }

  return {
    reportId: classification.reportId,
    documentoIndex: classification.documentoIndex,
    documentoNome: classification.documentoNome,
    clienteId: classification.clientId,
    clienteNome: classification.clientName,
    regimeTributario: classification.regimeTributario,
    agenteProcessador: 'AGENTE_4_NOTAS',
    ...dados,
    integridade,
    compras: {
      total: formatarValorBR(totalCompras),
      itensCompras
    },
    comprasMes: formatarValorBR(totalCompras),
    timestampProcessamento: new Date().toISOString()
  };
}

function processAgent5(rawText: string, classification: ClassificationResult) {
  const cleanText = cleanJson(rawText);
  let dados: any;
  try {
    dados = JSON.parse(cleanText);
  } catch (error: any) {
    throw new Error(`Erro ao parsear JSON do Agente 5: ${error?.message || 'parse_error'}`);
  }

  const toMinutes = (value: any) => {
    if (typeof value === 'number') {
      return Math.round(value * 60);
    }
    if (!value) return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    if (raw.includes(':')) {
      const [h, m] = raw.split(':').map((item) => Number(item));
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    }
    const numeric = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
  };

  const dadosOriginais = {
    reportId: classification.reportId,
    documentoIndex: classification.documentoIndex,
    documentoNome: classification.documentoNome || 'Controle de Jornada',
    clienteId: classification.clientId,
    clienteNome: classification.clientName,
    regimeTributario: classification.regimeTributario
  };
  const integridade = buildIntegridade('AGENTE_5', dados);

  const funcionarios = Array.isArray(dados?.funcionarios) ? dados.funcionarios : [];
  const hasValid = funcionarios.some((func: any) => {
    const dias = Number(func?.diasTrabalhados ?? func?.dias ?? 0);
    const totalMinutes =
      toMinutes(func?.horasTrabalhadas) +
      toMinutes(func?.horasExtras) +
      toMinutes(func?.atrasos) +
      toMinutes(func?.faltas);
    const meta = Boolean(func?.cargo || func?.observacoes);
    return dias > 0 || totalMinutes > 0 || meta;
  });
  const hasTimePattern = /\b\d{2}:\d{2}\b/.test(rawText || '');
  const hasFuncionarios = funcionarios.length > 0;
  if (!hasValid && !(hasFuncionarios || hasTimePattern)) {
    return {
      ...dadosOriginais,
      agenteProcessador: 'AGENTE_5_JORNADA',
      ...dados,
      integridade,
      temErro: false,
      semDados: true,
      observacoes: (dados?.observacoes || 'Sem registros de jornada no período informado.').trim(),
      timestampProcessamento: new Date().toISOString()
    };
  }
  if (!hasValid && (hasFuncionarios || hasTimePattern)) {
    dados = {
      ...dados,
      observacoes: (dados?.observacoes || 'Registros de jornada sem totalização explícita.').trim()
    };
  }

  return {
    ...dadosOriginais,
    agenteProcessador: 'AGENTE_5_JORNADA',
    ...dados,
    integridade,
    timestampProcessamento: new Date().toISOString(),
    temErro: false
  };
}

function buildResumo(classificacoes: ClassificationResult[], extractions: any[]) {
  const tipos: Record<string, number> = {};
  for (const item of classificacoes) {
    tipos[item.tipo] = (tipos[item.tipo] || 0) + 1;
  }

  const porAgente: Record<string, number> = {};
  for (const item of extractions) {
    const agente = item?.agenteProcessador || 'DESCONHECIDO';
    porAgente[agente] = (porAgente[agente] || 0) + 1;
  }

  return {
    totalDocumentos: classificacoes.length,
    porTipo: tipos,
    porAgente
  };
}

function detectInputFormat(content: string): 'base64' | 'json' | 'csv' | 'text' {
  const raw = (content || '').trim();
  if (!raw) return 'text';
  if (raw.startsWith('data:') && raw.includes(';base64,')) return 'base64';
  if (isProbablyBase64(raw)) return 'base64';

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      JSON.parse(raw);
      return 'json';
    } catch {
      // fallthrough
    }
  }

  const firstLine = raw.split('\n')[0] || '';
  if (firstLine.includes(',') && raw.includes('\n')) {
    return 'csv';
  }

  return 'text';
}

function normalizeTextContent(content: string, format: 'json' | 'csv' | 'text' | 'base64'): string {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content.trim();
    }
  }
  if (format === 'csv') {
    return content.trim();
  }
  return content.trim();
}

function isProbablyBase64(content: string): boolean {
  const raw = (content || '').trim();
  if (!raw || raw.length < 32) return false;
  if (raw.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return false;
  try {
    const sample = Buffer.from(raw, 'base64').toString('base64');
    return sample.replace(/=+$/, '') === raw.replace(/\s/g, '').replace(/=+$/, '');
  } catch {
    return false;
  }
}

function cleanJson(text: string) {
  const raw = (text || '').replace(/```json|```/g, '').trim();
  if (!raw) return raw;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return raw.slice(first, last + 1).trim();
  }
  return raw;
}

function decodeBase64(content: string): Buffer {
  const raw = content.startsWith('data:') ? content.split(',').pop() || '' : content;
  return Buffer.from(raw, 'base64');
}

function inferMimeType(content?: string) {
  if (!content || !content.startsWith('data:')) return null;
  const header = content.split(',')[0];
  const match = header.match(/data:([^;]+);base64/);
  return match ? match[1] : null;
}

function readEnvOrFile(name: string, logTask?: (task: string, detail?: string) => void) {
  const direct = (process.env[name] || '').trim();
  if (direct) {
    return direct;
  }
  const fileVar = `${name}_FILE`;
  const filePath = (process.env[fileVar] || '').trim();
  if (!filePath) {
    return '';
  }
  try {
    const value = require('fs').readFileSync(filePath, 'utf8').trim();
    if (value && logTask) {
      logTask('secret_lido', `${fileVar}=${filePath}`);
    }
    return value;
  } catch (error) {
    if (logTask) {
      logTask('secret_erro', `${fileVar}=${filePath} ${String(error)}`);
    }
    return '';
  }
}

function getNumberEnv(name: string, fallback: number) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
