import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Gemini File API Upload Edge Function
 * 
 * Implements the n8n workflow steps 7-10:
 * - Step 7: Upload file to Gemini File API
 * - Step 8: Process upload complete, get file_uri
 * - Step 9: Wait for processing
 * - Step 10: Check if file is ACTIVE
 * 
 * Reference: docs/gemini_api_language_docs.md
 */

interface GeminiFileResponse {
  file: {
    name: string;
    displayName: string;
    mimeType: string;
    sizeBytes: string;
    createTime: string;
    updateTime: string;
    expirationTime: string;
    sha256Hash: string;
    uri: string;
    state: "PROCESSING" | "ACTIVE" | "FAILED";
  };
}

// Função para fazer upload resumível para o Gemini (Passo 7)
async function uploadFileToGemini(
  fileBuffer: Uint8Array,
  fileName: string,
  mimeType: string,
  apiKey: string
): Promise<GeminiFileResponse> {
  console.log(`[Gemini Upload] Iniciando upload: ${fileName} (${mimeType})`);

  // Step 1: Iniciar upload resumível
  const initResponse = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileBuffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: fileName,
        },
      }),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    console.error("[Gemini Upload] Erro ao iniciar upload:", initResponse.status, errorText);
    throw new Error(`Failed to initiate upload: ${initResponse.status} - ${errorText}`);
  }

  const uploadUrl = initResponse.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new Error("No upload URL returned from Gemini API");
  }

  console.log(`[Gemini Upload] URL de upload obtida, enviando ${fileBuffer.length} bytes`);

  // Step 2: Enviar bytes do arquivo
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(fileBuffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileBuffer.buffer as ArrayBuffer,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error("[Gemini Upload] Erro ao enviar arquivo:", uploadResponse.status, errorText);
    throw new Error(`Failed to upload file: ${uploadResponse.status} - ${errorText}`);
  }

  const result = await uploadResponse.json() as GeminiFileResponse;
  console.log(`[Gemini Upload] Upload concluído: ${result.file.uri}, estado: ${result.file.state}`);

  return result;
}

// Função para verificar status do arquivo (Passos 9-10)
async function waitForFileActive(
  fileName: string,
  apiKey: string,
  maxAttempts = 10,
  delayMs = 2000
): Promise<GeminiFileResponse["file"]> {
  console.log(`[Gemini Upload] Aguardando arquivo ficar ACTIVE: ${fileName}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error(`[Gemini Upload] Erro ao verificar status (tentativa ${attempt}):`, response.status);
      if (attempt === maxAttempts) {
        throw new Error(`Failed to check file status after ${maxAttempts} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const fileInfo = await response.json() as GeminiFileResponse["file"];
    console.log(`[Gemini Upload] Tentativa ${attempt}: estado = ${fileInfo.state}`);

    if (fileInfo.state === "ACTIVE") {
      return fileInfo;
    }

    if (fileInfo.state === "FAILED") {
      throw new Error("File processing failed in Gemini");
    }

    // Aguardar antes de verificar novamente
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`File did not become ACTIVE after ${maxAttempts} attempts`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentoId } = await req.json();

    if (!documentoId) {
      return new Response(
        JSON.stringify({ error: "documentoId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Buscar documento
    const { data: documento, error: docError } = await supabase
      .from("documentos")
      .select("*, clientes_pj(razao_social, cnpj)")
      .eq("id", documentoId)
      .single();

    if (docError || !documento) {
      console.error("[Gemini Upload] Documento não encontrado:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Gemini Upload] Processando documento: ${documento.nome_original}`);

    // Atualizar status para processando
    await supabase
      .from("documentos")
      .update({ status: "processando" })
      .eq("id", documentoId);

    // Download do arquivo do Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documentos")
      .download(documento.storage_path);

    if (downloadError || !fileData) {
      console.error("[Gemini Upload] Erro ao baixar arquivo:", downloadError);
      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Erro ao baixar arquivo do storage" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Failed to download file from storage" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Converter para buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    console.log(`[Gemini Upload] Arquivo baixado: ${fileBuffer.length} bytes`);

    // Upload para Gemini File API (Passo 7-8)
    let geminiFile: GeminiFileResponse;
    try {
      geminiFile = await uploadFileToGemini(
        fileBuffer,
        documento.nome_original,
        documento.tipo_mime,
        GEMINI_API_KEY
      );
    } catch (uploadError) {
      console.error("[Gemini Upload] Erro no upload para Gemini:", uploadError);
      await supabase
        .from("documentos")
        .update({ 
          status: "erro", 
          erro_mensagem: `Erro no upload para Gemini: ${uploadError instanceof Error ? uploadError.message : "Unknown error"}` 
        })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Failed to upload to Gemini" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Aguardar arquivo ficar ACTIVE (Passos 9-10)
    let activeFile: GeminiFileResponse["file"];
    try {
      activeFile = await waitForFileActive(geminiFile.file.name, GEMINI_API_KEY);
    } catch (waitError) {
      console.error("[Gemini Upload] Erro ao aguardar arquivo:", waitError);
      await supabase
        .from("documentos")
        .update({ 
          status: "erro", 
          erro_mensagem: `Arquivo não processado pelo Gemini: ${waitError instanceof Error ? waitError.message : "Unknown error"}` 
        })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "File processing failed in Gemini" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Gemini Upload] Arquivo ACTIVE: ${activeFile.uri}`);

    // Salvar file_uri no documento para uso posterior
    await supabase
      .from("documentos")
      .update({ 
        gemini_file_uri: activeFile.uri,
        gemini_file_name: activeFile.name,
      })
      .eq("id", documentoId);

    // Chamar classificação com file_uri
    console.log(`[Gemini Upload] Chamando classify-document com file_uri`);

    const classifyResponse = await fetch(`${SUPABASE_URL}/functions/v1/classify-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        documentoId,
        geminiFileUri: activeFile.uri,
        geminiFileName: activeFile.name,
      }),
    });

    if (!classifyResponse.ok) {
      const errorText = await classifyResponse.text();
      console.error("[Gemini Upload] Erro na classificação:", errorText);
      // Não falhar completamente - o upload foi bem-sucedido
    } else {
      const classifyResult = await classifyResponse.json();
      console.log("[Gemini Upload] Classificação concluída:", classifyResult);
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentoId,
        geminiFile: {
          name: activeFile.name,
          uri: activeFile.uri,
          state: activeFile.state,
          mimeType: activeFile.mimeType,
          sizeBytes: activeFile.sizeBytes,
          expirationTime: activeFile.expirationTime,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Gemini Upload] Erro inesperado:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
