const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runDocumentWorkflow } = require('../dist/agent/langgraphWorkflow.js');

dotenv.config({ path: path.join(process.cwd(), '.env.development') });

const baseDir =
  '/Users/naive/Downloads/ORGAS/references/parecer_pessoal/documentos referencia/UROVELP';

const files = [
  'EXTRATO MENSAL - UROPELV.pdf',
  'Encargos de IRRF.pdf',
  'FOLHA PRONTO UROPELV.pdf',
  'FOLHAPONTO_UROPELV_COMPLETA.pdf',
  'PONTO (5).pdf',
  'Programação de Férias.pdf - UROPELV.pdf'
];

const documents = files.map((name, index) => {
  const filePath = path.join(baseDir, name);
  const buffer = fs.readFileSync(filePath);
  return {
    name,
    content: buffer.toString('base64'),
    mimeType: 'application/pdf',
    index
  };
});

const request = {
  message: 'Teste completo UROVELP - parecer pessoal',
  useLangGraph: true,
  tipoParecer: 'pessoal',
  categoria: 'parecer',
  competencia: '12/2025',
  clientName: 'UROVELP CLINICA DE FISIOTERAPIA LTDA',
  clientId: 'urovelp-test',
  referencesDir: '/Users/naive/Downloads/ORGAS/references',
  referenceFiles: ['parecer_pessoal.md'],
  includeReferences: true,
  documents
};

const logTask = (task, detail) => {
  const msg = detail ? `${task} - ${detail}` : task;
  // eslint-disable-next-line no-console
  console.log(`[AGENTE-IA] ${msg}`);
};

(async () => {
  try {
    const result = await runDocumentWorkflow(request, logTask);
    // eslint-disable-next-line no-console
    console.log('[TEST] resposta_length', (result.response || '').length);
    // eslint-disable-next-line no-console
    console.log('[TEST] resposta_preview', (result.response || '').slice(0, 2000));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TEST] erro', error);
    process.exitCode = 1;
  }
})();
