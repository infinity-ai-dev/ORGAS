import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AGENTE_3: Extrator de Folha de Pagamento
 * Especializado em documentos de folha/resumo de folha
 * 
 * Extrai:
 * - Totalizadores: bruto, INSS, FGTS, líquido
 * - Quantidade de funcionários
 * - Custo total (bruto + encargos)
 * - Pró-labore de sócios
 * 
 * ATUALIZAÇÃO: Agora usa Gemini File API para análise visual de PDFs/imagens
 */

const SYSTEM_PROMPT = `Você é um especialista em análise de documentos de folha de pagamento brasileira.

Sua tarefa é extrair dados estruturados de resumos de folha, identificando:

1. TOTALIZADORES:
   - Salário Bruto Total (soma de todos os funcionários)
   - INSS Patronal (20% + RAT + FAP + Terceiros)
   - INSS Descontado (parte do empregado)
   - FGTS (8% sobre remuneração)
   - Salário Líquido Total
   - Provisão de Férias
   - Provisão de 13º Salário

2. QUADRO DE FUNCIONÁRIOS:
   - Quantidade total de funcionários ativos
   - Quantidade de admissões no período
   - Quantidade de demissões no período

3. PRÓ-LABORE:
   - Valor do pró-labore de sócios
   - INSS sobre pró-labore (11% retido)

4. CUSTO TOTAL:
   - custoTotal = bruto + INSS patronal + FGTS + provisões

IMPORTANTE:
- Valores numéricos sem formatação
- Período de referência no formato MM/AAAA
- Se for folha de múltiplas competências, extrair cada uma separadamente

Responda APENAS com JSON válido no formato especificado.`;

interface ExtractedPayroll {
  periodo: string;
  quantidadeFuncionarios: number;
  admissoes: number;
  demissoes: number;
  salarioBrutoTotal: number;
  inssPatronal: number;
  inssDescontado: number;
  fgts: number;
  salarioLiquido: number;
  provisaoFerias: number;
  provisao13: number;
  proLabore: number;
  inssProLabore: number;
  custoTotal: number;
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
    console.log("[AGENTE_3] Using Gemini File API with URI:", fileUri);
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
    const { documentoId, nomeArquivo, clienteInfo } = await req.json();

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

    console.log(`[AGENTE_3] Processing payroll document: ${nomeArquivo}`);
    console.log(`[AGENTE_3] Gemini file URI: ${documento.gemini_file_uri || 'NOT AVAILABLE'}`);

    const userPrompt = `Analise este documento de folha de pagamento e extraia os dados estruturados:

Nome do arquivo: ${nomeArquivo}
Cliente: ${clienteInfo?.razao_social || "Não especificado"}
CNPJ: ${clienteInfo?.cnpj || "Não especificado"}
Período informado: ${documento.periodo || "Não especificado"}

Retorne um JSON com esta estrutura exata:
{
  "periodo": "MM/AAAA",
  "quantidadeFuncionarios": 0,
  "admissoes": 0,
  "demissoes": 0,
  "salarioBrutoTotal": 0,
  "inssPatronal": 0,
  "inssDescontado": 0,
  "fgts": 0,
  "salarioLiquido": 0,
  "provisaoFerias": 0,
  "provisao13": 0,
  "proLabore": 0,
  "inssProLabore": 0,
  "custoTotal": 0,
  "confianca": 0.85
}

NOTAS:
- custoTotal = salarioBrutoTotal + inssPatronal + fgts + provisaoFerias + provisao13
- inssPatronal geralmente é ~27-28% do bruto (20% INSS + RAT + FAP + Terceiros)
- fgts = 8% do bruto
- Se algum valor não estiver disponível, use 0`;

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

    let extracted: ExtractedPayroll;
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

    console.log("[AGENTE_3] Extracted payroll data:", extracted);

    // Calcular custo total se não veio calculado
    if (!extracted.custoTotal || extracted.custoTotal === 0) {
      extracted.custoTotal = 
        (extracted.salarioBrutoTotal || 0) + 
        (extracted.inssPatronal || 0) + 
        (extracted.fgts || 0) + 
        (extracted.provisaoFerias || 0) + 
        (extracted.provisao13 || 0);
    }

    // Salvar dados extraídos
    const { error: upsertError } = await supabase
      .from("dados_extraidos")
      .upsert({
        documento_id: documentoId,
        cliente_id: documento.cliente_id,
        tipo_documento: "folha_pagamento",
        competencia: extracted.periodo,
        valor_total: extracted.custoTotal,
        dados_folha: extracted,
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
        agente: "AGENTE_3_FOLHA",
        documentoId,
        usedFileApi: !!documento.gemini_file_uri,
        extracted: {
          periodo: extracted.periodo,
          quantidadeFuncionarios: extracted.quantidadeFuncionarios,
          salarioBruto: extracted.salarioBrutoTotal,
          custoTotal: extracted.custoTotal,
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
