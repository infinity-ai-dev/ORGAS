import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AGENTE_4: Extrator de Notas Fiscais
 * Especializado em NF-e, NFS-e, CT-e e Resumo por Acumulador
 * 
 * Extrai:
 * - Dados da nota: número, série, data, valores
 * - Impostos retidos: ISS, IRRF, PIS, COFINS
 * - Para Resumo por Acumulador: compras e vendas consolidadas
 * - Totais de notas emitidas/canceladas
 * 
 * ATUALIZAÇÃO: Agora usa Gemini File API para análise visual de PDFs/imagens
 */

const SYSTEM_PROMPT = `Você é um especialista em análise de documentos fiscais brasileiros (NF-e, NFS-e, CT-e, Resumo por Acumulador).

Sua tarefa é extrair dados estruturados, identificando:

1. PARA NF-e (Nota Fiscal Eletrônica de Mercadorias):
   - Número, Série, Data de Emissão
   - CNPJ Emitente e Destinatário
   - Valor Total da Nota
   - Valor dos Produtos
   - ICMS (base, alíquota, valor)
   - IPI (base, alíquota, valor)
   - PIS/COFINS se destacados

2. PARA NFS-e (Nota Fiscal de Serviços):
   - Número, Data de Emissão
   - CNPJ Prestador e Tomador
   - Valor do Serviço
   - Código do Serviço (LC 116)
   - ISS (alíquota, valor, retido ou não)
   - Impostos Retidos: IRRF, PIS, COFINS, CSLL, INSS

3. PARA CT-e (Conhecimento de Transporte):
   - Número, Série, Data
   - Valor do Frete
   - ICMS do Frete

4. PARA RESUMO POR ACUMULADOR (relatório contábil):
   - Total de Vendas por categoria
   - Total de Compras (para cálculo de margem)
   - Impostos consolidados do período

IMPORTANTE:
- Valores numéricos sem formatação
- Se documento tiver múltiplas notas, extrair lista
- Identificar se a nota foi CANCELADA
- Identificar gaps na numeração (notas faltantes)

Responda APENAS com JSON válido no formato especificado.`;

interface ImpostosRetidos {
  iss: number;
  issRetido: boolean;
  irrf: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
}

interface NotaExtraida {
  tipo: "nfe" | "nfse" | "cte";
  numero: string;
  serie: string | null;
  dataEmissao: string;
  cnpjEmitente: string;
  cnpjDestinatario: string | null;
  valorTotal: number;
  valorServicos: number;
  valorProdutos: number;
  impostos: ImpostosRetidos;
  cancelada: boolean;
}

interface ExtractedInvoices {
  periodo: string;
  tipoDocumento: "nfe" | "nfse" | "cte" | "resumo_acumulador";
  notas: NotaExtraida[];
  resumo: {
    totalNotas: number;
    totalCanceladas: number;
    valorTotalEmitido: number;
    valorTotalCancelado: number;
    totalImpostosRetidos: ImpostosRetidos;
  };
  compras: {
    valorTotal: number;
    quantidadeNotas: number;
  };
  gapsNumeracao: string[];
  confianca: number;
}

async function callGeminiWithFile(
  systemPrompt: string, 
  userPrompt: string, 
  fileUri: string | null,
  mimeType: string,
  temperature = 0.2
): Promise<{ content: string; tokensUsed: number }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Construir parts com ou sem arquivo
  const contentParts: any[] = [];
  
  if (fileUri) {
    contentParts.push({
      file_data: {
        mime_type: mimeType,
        file_uri: fileUri
      }
    });
    console.log("[AGENTE_4] Using Gemini File API with URI:", fileUri);
  }
  
  contentParts.push({ text: userPrompt });

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            parts: contentParts
          }
        ],
        generationConfig: {
          temperature,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

  return { content, tokensUsed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentoId, tipoClassificado, nomeArquivo, clienteInfo } = await req.json();

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
      console.error("GEMINI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: documento, error: docError } = await supabase
      .from("documentos")
      .select("*")
      .eq("id", documentoId)
      .single();

    if (docError || !documento) {
      console.error("Error fetching document:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determinar tipo de extração
    const tipoNormalizado = (tipoClassificado || "").toLowerCase();
    let tipoExtracao: "nfe" | "nfse" | "cte" | "resumo_acumulador" = "nfe";
    
    if (tipoNormalizado.includes("nfs") || tipoNormalizado.includes("serviço")) {
      tipoExtracao = "nfse";
    } else if (tipoNormalizado.includes("ct-e") || tipoNormalizado.includes("transporte")) {
      tipoExtracao = "cte";
    } else if (tipoNormalizado.includes("acumulador") || tipoNormalizado.includes("resumo")) {
      tipoExtracao = "resumo_acumulador";
    }

    console.log(`[AGENTE_4] Processing invoice document: ${nomeArquivo}, tipo: ${tipoExtracao}`);
    console.log(`[AGENTE_4] Gemini file URI: ${documento.gemini_file_uri || 'NOT AVAILABLE'}`);

    const userPrompt = `Analise este documento fiscal e extraia os dados estruturados:

Nome do arquivo: ${nomeArquivo}
Tipo identificado: ${tipoClassificado || "Não especificado"}
Cliente: ${clienteInfo?.razao_social || "Não especificado"}
CNPJ: ${clienteInfo?.cnpj || "Não especificado"}
Período informado: ${documento.periodo || "Não especificado"}

Retorne um JSON com esta estrutura exata:
{
  "periodo": "MM/AAAA",
  "tipoDocumento": "${tipoExtracao}",
  "notas": [
    {
      "tipo": "${tipoExtracao === 'resumo_acumulador' ? 'nfe' : tipoExtracao}",
      "numero": "string",
      "serie": "string ou null",
      "dataEmissao": "AAAA-MM-DD",
      "cnpjEmitente": "string",
      "cnpjDestinatario": "string ou null",
      "valorTotal": 0,
      "valorServicos": 0,
      "valorProdutos": 0,
      "impostos": {
        "iss": 0,
        "issRetido": false,
        "irrf": 0,
        "pis": 0,
        "cofins": 0,
        "csll": 0,
        "inss": 0
      },
      "cancelada": false
    }
  ],
  "resumo": {
    "totalNotas": 0,
    "totalCanceladas": 0,
    "valorTotalEmitido": 0,
    "valorTotalCancelado": 0,
    "totalImpostosRetidos": {
      "iss": 0,
      "issRetido": false,
      "irrf": 0,
      "pis": 0,
      "cofins": 0,
      "csll": 0,
      "inss": 0
    }
  },
  "compras": {
    "valorTotal": 0,
    "quantidadeNotas": 0
  },
  "gapsNumeracao": [],
  "confianca": 0.85
}

NOTAS:
- Se for Resumo por Acumulador, extrair totais consolidados em vez de notas individuais
- Identificar todas as notas CANCELADAS
- Calcular totalImpostosRetidos somando impostos de todas as notas
- gapsNumeracao: listar números faltantes na sequência (ex: ["123", "125"] se 124 estiver faltando)`;

    let content: string;
    let tokensUsed: number;
    
    try {
      const result = await callGeminiWithFile(
        SYSTEM_PROMPT, 
        userPrompt, 
        documento.gemini_file_uri,
        documento.tipo_mime || "application/pdf",
        0.2
      );
      content = result.content;
      tokensUsed = result.tokensUsed;
    } catch (error) {
      console.error("AI error:", error);
      return new Response(
        JSON.stringify({ error: "AI extraction failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!content) {
      console.error("No content in AI response");
      return new Response(
        JSON.stringify({ error: "Empty AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let extracted: ExtractedInvoices;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1]?.trim() || content.trim();
      extracted = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Error parsing AI response:", parseError, content);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[AGENTE_4] Extracted invoice data:", extracted);

    // Determinar tipo_documento para o banco
    let tipoDocumentoDB: string;
    switch (tipoExtracao) {
      case "nfse": tipoDocumentoDB = "nfse"; break;
      case "cte": tipoDocumentoDB = "cte"; break;
      default: tipoDocumentoDB = "nfe";
    }

    // Preparar dados específicos por tipo
    const dadosEspecificos = tipoExtracao === "nfse" 
      ? { dados_nfse: extracted }
      : { dados_nfe: extracted };

    // Salvar dados extraídos
    const { error: upsertError } = await supabase
      .from("dados_extraidos")
      .upsert({
        documento_id: documentoId,
        cliente_id: documento.cliente_id,
        tipo_documento: tipoDocumentoDB,
        competencia: extracted.periodo,
        valor_total: extracted.resumo.valorTotalEmitido,
        ...dadosEspecificos,
        impostos_retidos: extracted.resumo.totalImpostosRetidos,
        compras_mes: extracted.compras,
        confianca: extracted.confianca || 0.85,
        modelo_ia: "gemini-2.5-pro",
        tokens_usados: tokensUsed,
        extraido_em: new Date().toISOString(),
      }, {
        onConflict: "documento_id",
      });

    if (upsertError) {
      console.error("Error saving extracted data:", upsertError);
    }

    await supabase
      .from("documentos")
      .update({ status: "processado" })
      .eq("id", documentoId);

    return new Response(
      JSON.stringify({
        success: true,
        agente: "AGENTE_4_NOTAS",
        documentoId,
        usedFileApi: !!documento.gemini_file_uri,
        extracted: {
          periodo: extracted.periodo,
          tipo: tipoExtracao,
          totalNotas: extracted.resumo.totalNotas,
          valorTotal: extracted.resumo.valorTotalEmitido,
          totalImpostosRetidos: Object.values(extracted.resumo.totalImpostosRetidos || {})
            .filter(v => typeof v === 'number')
            .reduce((a, b) => (a as number) + (b as number), 0),
          gapsEncontrados: extracted.gapsNumeracao?.length || 0,
          confianca: extracted.confianca,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
