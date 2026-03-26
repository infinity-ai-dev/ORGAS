import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AGENTE_1: Extrator Financeiro
 * Especializado em extratos bancários e de cartão de crédito/débito
 * 
 * Extrai:
 * - Vendas por operadora (Stone, Cielo, PagBank, Rede, GetNet)
 * - PIX recebidos (quantidade e valor)
 * - Transferências (recebidas vs mesma titularidade)
 * - Total de movimento real
 * 
 * ATUALIZAÇÃO: Agora usa Gemini File API para análise visual de PDFs/imagens
 */

const SYSTEM_PROMPT = `Você é um especialista em análise de extratos bancários e de máquinas de cartão brasileiros.

Sua tarefa é extrair dados estruturados de extratos financeiros, identificando:

1. VENDAS POR OPERADORA DE CARTÃO:
   - Stone, Cielo, PagBank/PagSeguro, Rede, GetNet, Safrapay, SumUp
   - Separar crédito vs débito quando possível
   - Identificar antecipações de recebíveis

2. PIX RECEBIDOS:
   - Quantidade de transações
   - Valor total
   - Identificar se são de clientes (vendas) vs transferências internas

3. TRANSFERÊNCIAS:
   - TED/DOC recebidos
   - Separar transferências de mesma titularidade (entre contas próprias)
   - Transferências de terceiros (potenciais vendas)

4. OUTROS CRÉDITOS:
   - Depósitos em dinheiro
   - Boletos recebidos
   - Estornos

IMPORTANTE:
- Valores devem ser numéricos (sem R$, sem pontos de milhar)
- Datas no formato AAAA-MM-DD
- Período de referência no formato MM/AAAA
- totalMovimentoReal = vendas cartão + PIX de clientes + transferências de terceiros

Responda APENAS com JSON válido no formato especificado.`;

interface ExtractedFinancial {
  periodo: string;
  banco: string;
  agencia: string | null;
  conta: string | null;
  vendasCartao: {
    stone: number;
    cielo: number;
    pagbank: number;
    rede: number;
    getnet: number;
    outros: number;
    totalCredito: number;
    totalDebito: number;
    antecipacoes: number;
  };
  pixRecebidos: {
    quantidade: number;
    valorTotal: number;
    deClientes: number;
    transferenciasInternas: number;
  };
  transferencias: {
    tedDocRecebidos: number;
    mesmaTitularidade: number;
    deTerceiros: number;
  };
  outrosCreditos: {
    depositosDinheiro: number;
    boletosRecebidos: number;
    estornos: number;
  };
  totalMovimentoReal: number;
  saldoInicial: number;
  saldoFinal: number;
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
    console.log("[AGENTE_1] Using Gemini File API with URI:", fileUri);
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

    // Buscar documento com gemini_file_uri
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

    console.log(`[AGENTE_1] Processing financial document: ${nomeArquivo}`);
    console.log(`[AGENTE_1] Gemini file URI: ${documento.gemini_file_uri || 'NOT AVAILABLE'}`);

    const userPrompt = `Analise este extrato financeiro e extraia os dados estruturados:

Nome do arquivo: ${nomeArquivo}
Cliente: ${clienteInfo?.razao_social || "Não especificado"}
CNPJ: ${clienteInfo?.cnpj || "Não especificado"}
Período informado: ${documento.periodo || "Não especificado"}

Retorne um JSON com esta estrutura exata:
{
  "periodo": "MM/AAAA",
  "banco": "nome do banco",
  "agencia": "número ou null",
  "conta": "número ou null",
  "vendasCartao": {
    "stone": 0,
    "cielo": 0,
    "pagbank": 0,
    "rede": 0,
    "getnet": 0,
    "outros": 0,
    "totalCredito": 0,
    "totalDebito": 0,
    "antecipacoes": 0
  },
  "pixRecebidos": {
    "quantidade": 0,
    "valorTotal": 0,
    "deClientes": 0,
    "transferenciasInternas": 0
  },
  "transferencias": {
    "tedDocRecebidos": 0,
    "mesmaTitularidade": 0,
    "deTerceiros": 0
  },
  "outrosCreditos": {
    "depositosDinheiro": 0,
    "boletosRecebidos": 0,
    "estornos": 0
  },
  "totalMovimentoReal": 0,
  "saldoInicial": 0,
  "saldoFinal": 0,
  "confianca": 0.85
}`;

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

    // Parse JSON response
    let extracted: ExtractedFinancial;
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

    console.log("[AGENTE_1] Extracted financial data:", extracted);

    // Salvar/atualizar dados extraídos
    const { error: upsertError } = await supabase
      .from("dados_extraidos")
      .upsert({
        documento_id: documentoId,
        cliente_id: documento.cliente_id,
        tipo_documento: "extrato_bancario",
        competencia: extracted.periodo,
        valor_total: extracted.totalMovimentoReal,
        dados_extrato: extracted,
        vendas_cartao: extracted.vendasCartao,
        pix_recebidos: extracted.pixRecebidos,
        transferencias: extracted.transferencias,
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

    // Atualizar status do documento
    await supabase
      .from("documentos")
      .update({ status: "processado" })
      .eq("id", documentoId);

    return new Response(
      JSON.stringify({
        success: true,
        agente: "AGENTE_1_FINANCEIRO",
        documentoId,
        usedFileApi: !!documento.gemini_file_uri,
        extracted: {
          periodo: extracted.periodo,
          totalMovimentoReal: extracted.totalMovimentoReal,
          vendasCartao: extracted.vendasCartao.totalCredito + extracted.vendasCartao.totalDebito,
          pixRecebidos: extracted.pixRecebidos.valorTotal,
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
