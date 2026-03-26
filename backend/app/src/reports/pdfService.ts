// @ts-nocheck
// PDF generation + upload helpers for approved reports.

type Html2PdfResult = {
  bytes: Uint8Array;
};

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/^data:application\/pdf;base64,/, '');
  return Uint8Array.from(Buffer.from(normalized, 'base64'));
}

async function fetchPdfBytesFromResponse(res: Response): Promise<Uint8Array> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/pdf')) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (data) {
    const base64 =
      data.pdfBase64 ||
      data.base64 ||
      data.pdf_base64 ||
      data.data ||
      data.file ||
      data.pdf;
    if (typeof base64 === 'string' && base64.trim()) {
      return decodeBase64ToBytes(base64.trim());
    }

    const url = data.pdfUrl || data.url || data.fileUrl;
    if (typeof url === 'string' && url.trim()) {
      const fileRes = await fetch(url.trim());
      if (!fileRes.ok) {
        const errText = await fileRes.text();
        throw new Error(`HTML2PDF download failed (${fileRes.status}): ${errText}`);
      }
      return new Uint8Array(await fileRes.arrayBuffer());
    }
  }

  throw new Error('HTML2PDF response inválida');
}

export async function generatePdfFromHtml(
  html: string,
  options?: { fileName?: string }
): Promise<Html2PdfResult> {
  const baseUrl = (process.env.HTML2PDF_URL || '').trim();
  if (!baseUrl) {
    throw new Error('HTML2PDF_URL não configurado');
  }

  let requestUrl = baseUrl;
  try {
    const parsed = new URL(baseUrl);
    const fileNameParam = (process.env.HTML2PDF_FILENAME_PARAM || 'filemane').trim();
    if (options?.fileName && fileNameParam) {
      parsed.searchParams.set(fileNameParam, options.fileName);
    }
    requestUrl = parsed.toString();
  } catch {
    // ignore URL parsing issues and keep original
  }

  const res = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': (process.env.HTML2PDF_API_KEY || 'B8zbDepY97N6XIqU').trim(),
    },
    body: JSON.stringify({ html }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTML2PDF error ${res.status}: ${errText}`);
  }

  const bytes = await fetchPdfBytesFromResponse(res);
  return { bytes };
}

export async function uploadPdfToSupabase(params: {
  bytes: Uint8Array;
  fileName: string;
  bucket?: string;
}): Promise<{ publicUrl: string }> {
  const storageUrl = (process.env.SUPABASE_STORAGE_URL || '').trim();
  const serviceRole =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_SECRET || '').trim();
  if (!storageUrl) {
    throw new Error('SUPABASE_STORAGE_URL não configurado');
  }
  if (!serviceRole) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado');
  }

  const bucket = (params.bucket || 'parecer').trim();
  const normalizedStorageUrl = storageUrl.replace(/\/$/, '');
  const objectPath = encodeURIComponent(params.fileName);
  const uploadUrl = `${normalizedStorageUrl}/object/${bucket}/${objectPath}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      Authorization: `Bearer ${serviceRole}`,
      apikey: serviceRole,
      'x-upsert': 'true',
    },
    body: params.bytes,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Supabase upload failed (${uploadRes.status}): ${errText}`);
  }

  const baseUrl = normalizedStorageUrl.replace(/\/storage\/v1$/, '');
  const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${params.fileName}`;
  return { publicUrl };
}
