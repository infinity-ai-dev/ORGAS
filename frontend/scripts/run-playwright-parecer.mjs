import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const baseUrl = process.env.PW_BASE_URL || 'https://app.orgahold.com';
const email = process.env.PW_EMAIL || '';
const password = process.env.PW_PASSWORD || '';

if (!email || !password) {
  throw new Error('PW_EMAIL e PW_PASSWORD são obrigatórios.');
}

const repoRoot = '/Users/naive/Downloads/ORGAS';
const outDir = path.join(repoRoot, 'tmp', 'playwright');
fs.mkdirSync(outDir, { recursive: true });

const log = (msg) => {
  process.stdout.write(`[pw] ${msg}\n`);
};

const tryFill = async (page, selectors, value) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (count > 0) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
};

const tryClick = async (page, locator) => {
  try {
    await locator.click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => log(`console ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => log(`pageerror: ${String(err)}`));
  page.on('requestfailed', (req) => log(`requestfailed: ${req.url()} ${req.failure()?.errorText || ''}`));

  log(`goto ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await page.waitForTimeout(1000);

  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="mail" i]',
    'input[aria-label*="email" i]'
  ];
  const passSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="senha" i]',
    'input[aria-label*="senha" i]'
  ];

  const filledEmail = await tryFill(page, emailSelectors, email);
  const filledPass = await tryFill(page, passSelectors, password);

  log(`email preenchido=${filledEmail} senha preenchida=${filledPass}`);

  const loginButton = page.getByRole('button', { name: /entrar|login|acessar|continuar|sign in/i }).first();
  let clicked = await tryClick(page, loginButton);
  if (!clicked) {
    clicked = await tryClick(page, page.locator('button[type="submit"]').first());
  }
  log(`login click=${clicked}`);

  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, '01-after-login.png'), fullPage: true });

  const currentUrl = page.url();
  log(`url after login: ${currentUrl}`);

  const relLink = page.getByRole('link', { name: /relat|relatórios/i }).first();
  const relClicked = await tryClick(page, relLink);
  if (!relClicked) {
    const relTargets = [
      `${baseUrl.replace(/\/$/, '')}/relatorios`,
      `${baseUrl.replace(/\/$/, '')}/#/relatorios`,
      `${baseUrl.replace(/\/$/, '')}/app/relatorios`
    ];
    for (const target of relTargets) {
      try {
        await page.goto(target, { waitUntil: 'networkidle' });
        break;
      } catch {
        // ignore
      }
    }
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, '02-relatorios.png'), fullPage: true });

  // Tentar abrir o primeiro relatório visível
  const rowClick = await tryClick(page, page.locator('table tbody tr').first());
  if (!rowClick) {
    await tryClick(page, page.getByRole('button', { name: /ver|abrir|detalhes/i }).first());
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, '03-relatorio.png'), fullPage: true });

  const bodyText = await page.locator('body').innerText();
  const hasParecerPessoal = /parecer pessoal/i.test(bodyText);
  const competenciaMatch = bodyText.match(/Compet[eê]ncia\s*[:\-]?\s*(\d{2}\/\d{4})/i);

  log(`parecer pessoal visivel=${hasParecerPessoal}`);
  log(`competencia detectada=${competenciaMatch ? competenciaMatch[1] : 'nao encontrada'}`);

  await browser.close();
  log(`screenshots saved to ${outDir}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
