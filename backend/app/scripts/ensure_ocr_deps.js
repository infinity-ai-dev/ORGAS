#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
const autoInstall = (process.env.AUTO_INSTALL_OCR_DEPS || 'true').toLowerCase() !== 'false';

if (isProduction || !autoInstall) {
  process.exit(0);
}

const log = (msg) => console.log(`[OCR-DEPS] ${msg}`);
const warn = (msg) => console.warn(`[OCR-DEPS] ${msg}`);

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) {
    warn(`${cmd} failed: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    warn(`${cmd} exited with code ${result.status}`);
    return false;
  }
  return true;
};

const commandExists = (cmd) => {
  const result = spawnSync('which', [cmd], { stdio: 'ignore' });
  return result.status === 0;
};

if (!commandExists('python3')) {
  warn('python3 nao encontrado. Instale Python 3 para habilitar OCR.');
  process.exit(0);
}

if (!commandExists('pdftoppm')) {
  warn('pdftoppm (poppler) nao encontrado. Instale poppler (ex: brew install poppler).');
}

const venvDir = path.join(process.cwd(), '.venv-ocr');
const venvPython = path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(venvPython)) {
  log('Criando virtualenv local para OCR...');
  const ok = run('python3', ['-m', 'venv', venvDir]);
  if (!ok) {
    warn('Falha ao criar virtualenv. Abortando instalacao OCR.');
    process.exit(0);
  }
}

log('Instalando dependencias para leitura de PDF (pymupdf, pillow)...');
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPython, ['-m', 'pip', 'install', 'pymupdf', 'pillow']);

log(`OCR pronto. Usando python em ${venvPython}`);
