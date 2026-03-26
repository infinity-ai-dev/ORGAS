const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env.development') });

const reportId = process.argv[2] || process.env.REPORT_ID;
const reportJsonFile = process.env.REPORT_JSON_FILE || '';

if (!reportId && !reportJsonFile) {
  console.error('Uso: node scripts/validate-parecer-pessoal.js <reportId>');
  console.error('Ou defina REPORT_JSON_FILE=/caminho/para/secoes.json');
  process.exit(1);
}

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const extractCompetencia = (value) => {
  if (!value) return '';
  const match = String(value).match(/(\d{2})\/(\d{4})/);
  return match ? `${match[1]}/${match[2]}` : '';
};

const findDuplicates = (items, keyFn) => {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
};

const normalizeEventoName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
    .replace(/[\(\)\-–]/g, ' ')
    .replace(/\bde\b|\ba\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const hasDate = (value) => /\d{2}\/\d{2}\/\d{4}/.test(String(value || ''));

const loadFromDb = async (id) => {
  const db = require('../dist/config/database');
  const queries = [
    {
      label: 'pendentes',
      sql: 'SELECT id, competencia, secoes_json FROM relatorios_pendentes WHERE id = $1 LIMIT 1'
    },
    {
      label: 'aprovados',
      sql: 'SELECT relatorio_id as id, competencia, secoes_json FROM relatorios_aprovados WHERE relatorio_id = $1 LIMIT 1'
    }
  ];
  for (const q of queries) {
    const result = await db.reportsQuery(q.sql, [id]);
    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }
  return null;
};

const loadReport = async () => {
  if (reportJsonFile) {
    const content = fs.readFileSync(reportJsonFile, 'utf8');
    return { id: 'file', competencia: '', secoes_json: JSON.parse(content) };
  }
  if (!reportId) return null;
  return loadFromDb(reportId);
};

const ensureArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const run = async () => {
  let row;
  try {
    row = await loadReport();
  } catch (error) {
    console.error('Erro ao carregar relatório:', error.message || error);
    console.error('Verifique USE_INTERNAL_PG=true e variáveis DB_* ou REPORTS_DB_* no .env.development');
    process.exit(1);
  }

  if (!row) {
    console.error('Relatório não encontrado.');
    process.exit(1);
  }

  const secoes = row.secoes_json || {};
  const cab = secoes.dadosCabecalho || {};
  const competenciaPayload = extractCompetencia(cab.competencia || cab.periodo || row.competencia || '');

  const pagamentos = ensureArray(secoes.valoresPagamento?.itens || []);
  const folhaItem = pagamentos.find((item) => /folha/i.test(String(item?.documento || item?.descricao || '')));
  const competenciaRef = extractCompetencia(folhaItem?.documento || folhaItem?.descricao || folhaItem?.periodo || '');

  const pendenciasJornada = ensureArray(secoes.controleJornada?.pendencias || []);
  const pendenciasAnexos = ensureArray(secoes.anexos?.pendencias || []);
  const ferias = ensureArray(secoes.eventosDP?.ferias || []);
  const completude = secoes.controleJornada?.completude || null;

  const issues = [];

  const dupPendencias = findDuplicates(pendenciasJornada, (item) => normalizeText(item));
  if (dupPendencias.length > 0) {
    issues.push(`Pendências de jornada duplicadas: ${dupPendencias.map((d) => `${d.key} (${d.count}x)`).join(', ')}`);
  }
  const extracaoCsvCount = pendenciasJornada.filter((item) => /extração a partir de csv/i.test(String(item))).length;
  if (extracaoCsvCount > 1) {
    issues.push(`Pendência "Extração a partir de CSV" aparece ${extracaoCsvCount}x.`);
  }

  const feriasByName = new Map();
  ferias.forEach((item) => {
    const key = normalizeEventoName(item);
    if (!key) return;
    const entry = feriasByName.get(key) || { withDate: 0, withoutDate: 0, raw: [] };
    entry.raw.push(String(item));
    if (hasDate(item)) entry.withDate += 1;
    else entry.withoutDate += 1;
    feriasByName.set(key, entry);
  });
  for (const [key, entry] of feriasByName.entries()) {
    if (entry.withDate > 0 && entry.withoutDate > 0) {
      issues.push(`Férias duplicadas (com e sem data) para "${key}": ${entry.raw.join(' | ')}`);
    }
    if (entry.withDate + entry.withoutDate > 1 && entry.withDate === 0) {
      issues.push(`Férias duplicadas para "${key}" sem data: ${entry.raw.join(' | ')}`);
    }
  }

  if (completude && Number(completude.percentual || 0) > 100) {
    issues.push(`Completude acima de 100% exibida (${completude.percentual}%).`);
  }
  if (completude && completude.capacidade) {
    const rawPct = Math.round((Number(completude.diasTrabalhados || 0) / Number(completude.capacidade || 1)) * 100);
    const hasPendencia = pendenciasJornada.some((item) => /completude acima de 100%/i.test(String(item)));
    if (rawPct > 100 && !hasPendencia) {
      issues.push(`Completude calculada > 100% (${rawPct}%) sem pendência correspondente.`);
    }
  }

  if (competenciaPayload && competenciaRef && competenciaPayload !== competenciaRef) {
    const hasPendencia = pendenciasAnexos.some((item) =>
      /compet[eê]ncia do relatório/i.test(String(item)) &&
      String(item).includes(competenciaPayload) &&
      String(item).includes(competenciaRef)
    );
    if (!hasPendencia) {
      issues.push(`Competência divergente (${competenciaPayload} vs ${competenciaRef}) sem pendência em anexos.`);
    }
  }

  console.log('=== VALIDACAO PARECER PESSOAL ===');
  console.log(`Relatorio: ${row.id}`);
  console.log(`Competencia cabecalho: ${competenciaPayload || '-'}`);
  console.log(`Competencia folha: ${competenciaRef || '-'}`);
  console.log(`Pendencias jornada: ${pendenciasJornada.length}`);
  console.log(`Pendencias anexos: ${pendenciasAnexos.length}`);
  console.log(`Ferias listadas: ${ferias.length}`);
  if (completude) {
    console.log(`Completude exibida: ${completude.percentual || 0}% (dias ${completude.diasTrabalhados}/${completude.capacidade || completude.diasUteis || '-'})`);
  }

  if (issues.length === 0) {
    console.log('✅ Nenhuma inconsistência encontrada para as correções solicitadas.');
    process.exit(0);
  }

  console.log('❌ Inconsistências encontradas:');
  issues.forEach((item) => console.log(`- ${item}`));
  process.exit(1);
};

run();
