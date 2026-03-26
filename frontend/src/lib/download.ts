import { apiFetch, buildApiUrl, getAuthToken } from '@/lib/api';

export function guessFileName(url: string, fallback = 'download.pdf') {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // ignore parse errors and fallback to raw split
  }
  const last = url.split('/').pop();
  return last ? decodeURIComponent(last) : fallback;
}

function extractFileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/"/g, '').trim());
  }
  const asciiMatch = disposition.match(/filename="?([^"]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1].trim();
  }
  return null;
}

function resolveBrowserUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return new URL(url, window.location.origin).toString();
}

function triggerNativeUrlDownload(url: string) {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = resolveBrowserUrl(url);
  document.body.appendChild(frame);

  window.setTimeout(() => {
    frame.remove();
  }, 60_000);
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Firefox and some Chromium builds can drop the download if the blob URL is
  // revoked immediately after the synthetic click.
  window.setTimeout(() => {
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }, 30_000);
}

export async function downloadFile(url: string, fileName?: string) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status}): ${text}`);
  }
  const blob = await response.blob();
  triggerBlobDownload(blob, fileName || guessFileName(url));
}

export async function downloadApiFile(path: string, fileName?: string) {
  const url = buildApiUrl(path);
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const frontendSecret = import.meta.env.VITE_FRONTEND_PROXY_SECRET || '';
  if (frontendSecret) {
    headers['X-Frontend-Secret'] = frontendSecret;
  }

  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status}): ${text}`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition');
  const resolvedName = extractFileNameFromDisposition(disposition) || fileName || guessFileName(url);
  triggerBlobDownload(blob, resolvedName);
}

export async function downloadApiFileNative(path: string) {
  const data = await apiFetch<{ success: boolean; url?: string; fileName?: string | null }>(path, {
    method: 'GET'
  });

  if (!data?.url) {
    throw new Error('URL de download não disponível');
  }

  triggerNativeUrlDownload(data.url);
  return {
    url: data.url,
    fileName: data.fileName || null,
  };
}
