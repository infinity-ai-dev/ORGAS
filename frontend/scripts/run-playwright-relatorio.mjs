import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const baseUrl = process.env.PW_BASE_URL || 'https://app.orgahold.com';
const reportUrl = process.env.PW_REPORT_URL || '';
const email = process.env.PW_EMAIL || '';
const password = process.env.PW_PASSWORD || '';

if (!email || !password) {
  throw new Error('PW_EMAIL e PW_PASSWORD são obrigatórios.');
}
if (!reportUrl) {
  throw new Error('PW_REPORT_URL é obrigatório.');
}

const repoRoot = '/Users/naive/Downloads/ORGAS';
const outDir = path.join(repoRoot, 'tmp', 'playwright');
fs.mkdirSync(outDir, { recursive: true });

const log = (msg) => {
  process.stdout.write(`[pw] ${msg}\n`);
};

const MAX_HTML_CAPTURE = 200_000;

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

const collectFrameTexts = async (page) => {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText();
      if (text) {
        texts.push(text);
      }
    } catch {
      // ignore frames without access
    }
  }
  return texts;
};

const countOccurrences = (text, pattern) => {
  const match = text.match(pattern);
  return match ? match.length : 0;
};

const tryOpenPreview = async (page) => {
  const previewRegex = /prévia do parecer|previa do parecer|prévia|previa|visualizar|ver parecer|ver relatório|ver relatorio|abrir parecer|abrir relatório|abrir relatorio|imprimir|pdf|html/i;
  const candidates = [
    page.getByRole('button', { name: previewRegex }).first(),
    page.getByRole('link', { name: previewRegex }).first(),
    page.locator('[data-testid*="preview"], [data-testid*="previa"], [data-testid*="parecer"], [data-testid*="pdf"], [data-testid*="html"]').first(),
    page.locator(`text=${'Prévia do parecer'}`),
    page.locator(`text=${'Prévia'}`),
    page.locator(`text=${'Visualizar'}`),
    page.locator(`text=${'Ver parecer'}`),
    page.locator(`text=${'Ver relatório'}`),
    page.locator(`text=${'Abrir PDF'}`),
    page.locator(`text=${'PDF'}`),
    page.locator(`text=${'HTML'}`)
  ];

  for (const locator of candidates) {
    const clicked = await tryClick(page, locator);
    if (clicked) {
      return true;
    }
  }

  const actionsButton = page.getByRole('button', { name: /ações|acoes|menu/i }).first();
  if (await tryClick(page, actionsButton)) {
    for (const locator of candidates) {
      const clicked = await tryClick(page, locator);
      if (clicked) {
        return true;
      }
    }
  }

  return false;
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const htmlCaptures = [];
  const jsonCaptures = [];
  const pdfUrls = new Set();
  let accessToken = '';
  let authCaptured = false;
  let apiAuthHeader = '';
  let apiKeyHeader = '';

  page.on('console', (msg) => log(`console ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => log(`pageerror: ${String(err)}`));
  page.on('requestfailed', (req) => log(`requestfailed: ${req.url()} ${req.failure()?.errorText || ''}`));
  page.on('request', (req) => {
    const url = req.url();
    const headers = req.headers();
    if (/\/api\/relatorios/i.test(url)) {
      const authHeader = headers['authorization'] || headers['Authorization'];
      const apiKey = headers['apikey'] || headers['x-api-key'] || headers['X-API-Key'];
      if (authHeader && !apiAuthHeader) {
        apiAuthHeader = authHeader;
      }
      if (apiKey && !apiKeyHeader) {
        apiKeyHeader = apiKey;
      }
    }
    if (/\/api\/relatorios/i.test(url) || /supabase|auth/i.test(url)) {
      const authHeader = headers['authorization'] || headers['Authorization'];
      if (authHeader && authHeader.startsWith('Bearer ') && !accessToken) {
        accessToken = authHeader.replace(/^Bearer\\s+/i, '').trim();
        authCaptured = true;
        log('auth token capturado via request=sim');
      }
    }
  });
  page.on('response', async (response) => {
    const url = response.url();
    const headers = response.headers() || {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
    if (/application\/pdf/i.test(contentType) || /\.pdf(\?|$)/i.test(url)) {
      pdfUrls.add(url);
      return;
    }
    if (/application\/json/i.test(contentType) && /relatorios/i.test(url)) {
      try {
        const json = await response.json();
        jsonCaptures.push({ url, json });
      } catch {
        // ignore
      }
      return;
    }
    if (/text\/html/i.test(contentType) && /relatorios|parecer|html/i.test(url)) {
      try {
        const text = await response.text();
        htmlCaptures.push({
          url,
          text: text.slice(0, MAX_HTML_CAPTURE)
        });
      } catch {
        // ignore
      }
    }
  });

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

  await page.waitForTimeout(3000);

  try {
    const localEntries = await page.evaluate(() => Object.entries(localStorage));
    const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
    const entries = [...localEntries, ...sessionEntries];
    for (const [key, value] of entries) {
      const keyLower = String(key || '').toLowerCase();
      if (!value || (!keyLower.includes('auth') && !keyLower.includes('supabase') && !keyLower.includes('token'))) {
        continue;
      }
      try {
        const parsed = JSON.parse(value);
        const token =
          parsed?.access_token ||
          parsed?.currentSession?.access_token ||
          parsed?.session?.access_token ||
          parsed?.data?.session?.access_token;
        if (token) {
          accessToken = token;
          break;
        }
      } catch {
        if (String(value).startsWith('eyJ')) {
          accessToken = String(value);
          break;
        }
      }
    }
  } catch {
    // ignore storage read errors
  }
  if (!accessToken) {
    try {
      const cookies = await context.cookies(baseUrl);
      const tokenCookie = cookies.find((cookie) => /token/i.test(cookie.name) && String(cookie.value).startsWith('eyJ'));
      if (tokenCookie) {
        accessToken = tokenCookie.value;
      }
    } catch {
      // ignore cookie errors
    }
  }
  log(`auth token encontrado=${accessToken ? 'sim' : 'nao'}`);

  log(`goto report ${reportUrl}`);
  await page.goto(reportUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const reportMatch = reportUrl.match(/relatorios\/(\d+)/i);
  const reportId = reportMatch ? reportMatch[1] : `relatorio_${Date.now()}`;

  const probeEndpoints = [
    `/relatorios/${reportId}`,
    `/api/relatorios/${reportId}`,
    `/relatorios/${reportId}/html`,
    `/api/relatorios/${reportId}/html`,
    `/relatorios/${reportId}/secoes`,
    `/api/relatorios/${reportId}/secoes`
  ];
  for (const endpoint of probeEndpoints) {
    try {
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
      const res = await page.request.get(`${baseUrl.replace(/\/$/, '')}${endpoint}`, { headers });
      const contentType = String(res.headers()['content-type'] || '');
      if (contentType.includes('application/json')) {
        const json = await res.json();
        jsonCaptures.push({ url: `${baseUrl}${endpoint}`, json });
        log(`probe json ${endpoint} status=${res.status()}`);
      } else {
        const text = await res.text();
        if (text && contentType.includes('text/html')) {
          htmlCaptures.push({ url: `${baseUrl}${endpoint}`, text: text.slice(0, MAX_HTML_CAPTURE) });
        }
        log(`probe text ${endpoint} status=${res.status()}`);
      }
    } catch (err) {
      log(`probe error ${endpoint}: ${String(err)}`);
    }
  }

  const screenshotPath = path.join(outDir, `04-relatorio-${reportId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
  const previewClicked = await tryOpenPreview(page);
  log(`preview click=${previewClicked}`);
  if (previewClicked) {
    await page.waitForTimeout(4000);
  }

  const popup = await popupPromise;
  let popupText = '';
  if (popup) {
    try {
      await popup.waitForLoadState('networkidle', { timeout: 10000 });
      popupText = await popup.locator('body').innerText();
      const popupShot = path.join(outDir, `05-relatorio-${reportId}-popup.png`);
      await popup.screenshot({ path: popupShot, fullPage: true });
      log(`popup screenshot saved to ${popupShot}`);
    } catch (err) {
      log(`popup error: ${String(err)}`);
    }
  }

  const screenshotPreviewPath = path.join(outDir, `05-relatorio-${reportId}-preview.png`);
  await page.screenshot({ path: screenshotPreviewPath, fullPage: true });

  const frameTexts = await collectFrameTexts(page);
  const allText = [frameTexts.join('\n\n'), popupText]
    .filter(Boolean)
    .join('\n\n');

  const hasParecerPessoal = /parecer pessoal/i.test(allText);
  const competenciaMatch = allText.match(/Compet[eê]ncia\s*[:\-]?\s*(\d{2}\/\d{4})/i);
  const completudeMatch = allText.match(/\((\d{1,3})%\)/);

  const lauraCount = countOccurrences(allText, /LAURA MIRANDA COSTA/gi);
  const lisbeteCount = countOccurrences(allText, /LISBETE DAS DORES SANTANA FERREIRA/gi);
  const extracaoCsvCount = countOccurrences(allText, /Extração a partir de CSV/gi);
  const pendenciaCompletude = /Completude acima de 100%/i.test(allText);
  const pendenciaCompetencia = /Compet[eê]ncia do relatório .* divergente/i.test(allText);

  log(`parecer pessoal visivel=${hasParecerPessoal}`);
  log(`competencia detectada=${competenciaMatch ? competenciaMatch[1] : 'nao encontrada'}`);
  log(`completude percent detectado=${completudeMatch ? completudeMatch[1] : 'nao encontrado'}`);
  log(`ocorrencias Laura=${lauraCount} Lisbete=${lisbeteCount}`);
  log(`ocorrencias Extracao CSV=${extracaoCsvCount}`);
  log(`pendencia completude acima de 100=${pendenciaCompletude}`);
  log(`pendencia competencia divergente=${pendenciaCompetencia}`);
  log(`html captures=${htmlCaptures.length} pdf urls=${pdfUrls.size}`);

  if (htmlCaptures.length > 0) {
    const dumpPath = path.join(outDir, `06-relatorio-${reportId}-html.txt`);
    const dumpContent = htmlCaptures.map((item, idx) => `### HTML ${idx + 1}\nURL: ${item.url}\n\n${item.text}`).join('\n\n');
    fs.writeFileSync(dumpPath, dumpContent);
    log(`html dump saved to ${dumpPath}`);
  }
  if (jsonCaptures.length > 0) {
    const dumpPath = path.join(outDir, `07-relatorio-${reportId}-json.txt`);
    const dumpContent = jsonCaptures.map((item, idx) => `### JSON ${idx + 1}\nURL: ${item.url}\n\n${JSON.stringify(item.json, null, 2)}`).join('\n\n');
    fs.writeFileSync(dumpPath, dumpContent);
    log(`json dump saved to ${dumpPath}`);
  }
  if (pdfUrls.size > 0) {
    log(`pdf urls: ${Array.from(pdfUrls).join(', ')}`);
  }

  await browser.close();
  log(`screenshot saved to ${screenshotPath}`);
  log(`preview screenshot saved to ${screenshotPreviewPath}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
