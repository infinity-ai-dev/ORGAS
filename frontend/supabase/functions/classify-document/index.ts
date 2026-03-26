import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClassificationResult {
  tipo_documento: string;
  subtipo: string | null;
  competencia: string | null;
  confianca: number;
  cnpjDetectado?: string;
  estabelecimento?: string;
  metadata: Record<string, unknown>;
}

// Prompt de classificação otimizado para análise visual (Passos 12-14 do documento 100 passos)
const CLASSIFICATION_SYSTEM_PROMPT = `Você é um especialista em classificação de documentos fiscais e contábeis brasileiros.
Sua tarefa é ANALISAR VISUALMENTE o documento e classificá-lo corretamente.

## Tipos de documentos que você deve identificar:

### Documentos Fiscais do Simples Nacional:
- PGDAS_PDF: Extrato PGDAS-D com receita bruta, alíquota, estabelecimentos
- GUIA_DAS: Guia de pagamento DAS (apenas valor e vencimento)

### Extratos Financeiros:
- EXTRATO_BANCARIO: Extrato de conta corrente (Banco Inter, Bradesco, etc)
- EXTRATO_CARTAO: Extrato de vendas em cartão (Stone, Cielo, PagSeguro, Rede, GetNet, Mercado Pago)

### Documentos de Folha:
- FOLHA_PAGAMENTO: Resumo ou relatório de folha de pagamento

### Notas Fiscais:
- NFE_XML: XML de NF-e (nota fiscal eletrônica de mercadoria)
- NFSE_PDF: PDF de NFS-e (nota fiscal de serviços)
- CTE_XML: CT-e (conhecimento de transporte)
- DANFE: Documento auxiliar da NF-e impresso

### Relatórios Contábeis:
- RESUMO_ACUMULADOR: Relatório do sistema contábil com entradas/saídas
- BALANCETE: Balancete contábil
- DRE: Demonstração do Resultado

### Outros:
- GUIA_FEDERAL: DARF, GPS
- GUIA_ESTADUAL: ICMS
- GUIA_MUNICIPAL: ISS
- CONTRATO: Contrato social ou comercial
- OUTRO: Documento não identificado

## Instruções:
1. Analise VISUALMENTE o documento
2. Identifique indicadores visuais: logotipos, cabeçalhos, tabelas
3. Extraia CNPJ se visível
4. Identifique período/competência se visível
5. Determine se é MATRIZ ou FILIAL

Responda APENAS com JSON válido.`;

// Chamada Gemini com suporte a file_uri para análise visual
async function callGeminiWithFile(
  systemPrompt: string,
  userPrompt: string,
  fileUri: string | null,
  mimeType: string,
  temperature = 0.3
): Promise<{ content: string; tokensUsed: number }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Construir parts com ou sem file_uri
  const contentParts: Array<{ text?: string; file_data?: { mime_type: string; file_uri: string } }> = [];

  // Adicionar arquivo se disponível
  if (fileUri) {
    contentParts.push({
      file_data: {
        mime_type: mimeType,
        file_uri: fileUri,
      },
    });
    console.log(`[Classify] Usando file_uri para análise visual: ${fileUri}`);
  }

  // Adicionar prompt de texto
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
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            parts: contentParts,
          },
        ],
        generationConfig: {
          temperature,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Classify] Gemini API error:", response.status, errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

  return { content, tokensUsed };
}

// Mapeamento de tipo para agente (Passo 20 do documento 100 passos)
function getExtractionAgent(tipoDocumento: string): string {
  const tipo = tipoDocumento.toUpperCase();

  // PGDAS → Agente 2
  if (tipo.includes("PGDAS") || tipo.includes("DAS") || tipo.includes("SIMPLES")) {
    return "extract-pgdas";
  }

  // Extratos → Agente 1
  if (tipo.includes("EXTRATO") || tipo.includes("BANCARIO") || tipo.includes("CARTAO")) {
    return "extract-financial";
  }

  // Folha → Agente 3
  if (tipo.includes("FOLHA") || tipo.includes("PAGAMENTO") || tipo.includes("HOLERITE")) {
    return "extract-payroll";
  }

  // Notas → Agente 4
  if (
    tipo.includes("NF") ||
    tipo.includes("NOTA") ||
    tipo.includes("CTE") ||
    tipo.includes("DANFE") ||
    tipo.includes("ACUMULADOR")
  ) {
    return "extract-invoices";
  }

  // Fallback
  return "extract-data";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentoId, geminiFileUri, geminiFileName } = await req.json();

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
      console.error("[Classify] GEMINI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Atualizar status para processando
    await supabase.from("documentos").update({ status: "processando" }).eq("id", documentoId);

    // Buscar documento
    const { data: documento, error: docError } = await supabase
      .from("documentos")
      .select("*, clientes_pj(razao_social, cnpj)")
      .eq("id", documentoId)
      .single();

    if (docError || !documento) {
      console.error("[Classify] Error fetching document:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Classify] Processando: ${documento.nome_original} (${documento.tipo_mime})`);

    // Usar file_uri passado ou buscar do documento
    const fileUri = geminiFileUri || documento.gemini_file_uri;
    const hasVisualAnalysis = !!fileUri;

    console.log(`[Classify] Análise visual: ${hasVisualAnalysis ? "SIM" : "NÃO"}`);

    // Construir prompt do usuário
    const userPrompt = `Analise este documento e classifique-o:

Nome do arquivo: ${documento.nome_original}
Tipo MIME: ${documento.tipo_mime}
Cliente: ${documento.clientes_pj?.razao_social || "Não especificado"}
CNPJ do Cliente: ${documento.clientes_pj?.cnpj || "Não especificado"}
Período informado: ${documento.periodo || "Não especificado"}

${hasVisualAnalysis ? "O documento foi anexado para análise visual. Analise o CONTEÚDO VISUAL do documento." : ""}

Retorne um JSON com esta estrutura exata:
{
  "tipo_documento": "string (um dos tipos listados: PGDAS_PDF, EXTRATO_BANCARIO, EXTRATO_CARTAO, FOLHA_PAGAMENTO, NFSE_PDF, NFE_XML, etc)",
  "subtipo": "string ou null (detalhe adicional: STONE, CIELO, BANCO_INTER, etc)",
  "competencia": "string ou null (mês/ano identificado, formato MM/AAAA)",
  "confianca": number (0 a 1, nível de confiança),
  "cnpjDetectado": "string ou null (CNPJ encontrado no documento)",
  "estabelecimento": "MATRIZ ou FILIAL ou null",
  "metadata": { "indicadoresEncontrados": ["lista", "de", "indicadores"] }
}`;

    let content: string;
    try {
      const result = await callGeminiWithFile(
        CLASSIFICATION_SYSTEM_PROMPT,
        userPrompt,
        fileUri,
        documento.tipo_mime,
        0.3
      );
      content = result.content;
      console.log(`[Classify] Tokens usados: ${result.tokensUsed}`);
    } catch (error) {
      console.error("[Classify] AI error:", error);

      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Erro ao classificar documento" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "AI classification failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!content) {
      console.error("[Classify] No content in AI response");
      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Resposta vazia da IA" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Empty AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON (Passo 15)
    let classification: ClassificationResult;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1]?.trim() || content.trim();
      classification = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("[Classify] Error parsing AI response:", parseError, content);
      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Erro ao interpretar resposta da IA" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Classify] Resultado:", classification);

    // Validar confiança mínima (Passo 17)
    const precisaRevisao = classification.confianca < 0.7;
    if (precisaRevisao) {
      console.log(`[Classify] Baixa confiança (${classification.confianca}), marcando para revisão`);
    }

    // Atualizar documento com classificação
    const { error: updateError } = await supabase
      .from("documentos")
      .update({
        status: "classificado",
        erro_mensagem: null,
        classificacao_metadata: {
          ...classification,
          precisaRevisao,
          analisouVisualmente: hasVisualAnalysis,
        },
      })
      .eq("id", documentoId);

    if (updateError) {
      console.error("[Classify] Error updating document:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update document" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determinar agente especializado (Passo 19-20)
    const agentEndpoint = getExtractionAgent(classification.tipo_documento);
    console.log(`[Classify] Roteando para agente: ${agentEndpoint}`);

    // Chamar agente de extração especializado (Passo 24-25)
    try {
      const extractResponse = await fetch(`${SUPABASE_URL}/functions/v1/${agentEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          documentoId,
          tipoClassificado: classification.tipo_documento,
          nomeArquivo: documento.nome_original,
          clienteInfo: documento.clientes_pj,
          geminiFileUri: fileUri,
          cnpjDetectado: classification.cnpjDetectado,
          competenciaDetectada: classification.competencia,
        }),
      });

      if (!extractResponse.ok) {
        console.error(`[Classify] ${agentEndpoint} failed:`, await extractResponse.text());
      } else {
        const extractResult = await extractResponse.json();
        console.log(`[Classify] ${agentEndpoint} completed:`, extractResult);
      }
    } catch (extractError) {
      console.error("[Classify] Error calling extraction agent:", extractError);
      // Não falhar a classificação por erro na extração
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentoId,
        classification,
        agentEndpoint,
        usedVisualAnalysis: hasVisualAnalysis,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Classify] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
