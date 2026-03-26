import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AGENTE_2: Extrator PGDAS
 * Especializado em documentos PGDAS-D e Guias DAS
 * 
 * Extrai:
 * - Dados básicos: razão social, CNPJ, período, valor DAS
 * - Tabela de estabelecimentos (MATRIZ/FILIAL com receita/alíquota/imposto)
 * - Históricos mensais: receitas, folhas, impostos
 * - Anexo e Fator R aplicado
 * 
 * ATUALIZAÇÃO: Agora usa Gemini File API para análise visual de PDFs/imagens
 */

const SYSTEM_PROMPT = `Você é um especialista em análise de documentos PGDAS-D (Programa Gerador do Documento de Arrecadação do Simples Nacional).

Sua tarefa é extrair dados estruturados do PGDAS-D, identificando:

1. DADOS BÁSICOS:
   - Razão Social
   - CNPJ (matriz e filiais se houver)
   - Período de Apuração (PA) no formato MM/AAAA
   - Valor Total do DAS
   - Data de Vencimento

2. TABELA DE ESTABELECIMENTOS (Seção 2.1 do PGDAS):
   - Para cada CNPJ (MATRIZ e FILIAIs):
     - Tipo (MATRIZ ou FILIAL)
     - CNPJ
     - Receita Bruta do período
     - Alíquota Efetiva
     - Valor do Imposto

3. HISTÓRICO DE RECEITAS (Seção 2.2.1 - 12 meses anteriores):
   - Lista mensal com mês/ano e valor da receita bruta
   - Usar para calcular RBT12

4. HISTÓRICO DE FOLHA DE PAGAMENTO (Seção 2.3):
   - Lista mensal com mês/ano e valor da folha
   - Usar para calcular Fator R

5. HISTÓRICO DE IMPOSTOS (valores DAS mensais):
   - Lista mensal com mês/ano e valor pago

6. ANEXO E FATOR R:
   - Anexo aplicado (I, II, III, IV ou V)
   - Fator R calculado (folha 12 meses / receita 12 meses)
   - Se Fator R >= 28%, Anexo III; senão Anexo V (para serviços)

IMPORTANTE:
- Valores numéricos sem formatação (sem R$, sem pontos de milhar)
- Datas no formato AAAA-MM-DD
- Períodos no formato MM/AAAA
- Se for apenas uma Guia DAS (não PGDAS completo), extrair o que estiver disponível

Responda APENAS com JSON válido no formato especificado.`;

interface Estabelecimento {
  tipo: "MATRIZ" | "FILIAL";
  cnpj: string;
  receitaBruta: number;
  aliquotaEfetiva: number;
  valorImposto: number;
}

interface HistoricoMensal {
  mes: string; // MM/AAAA
  valor: number;
}

interface ExtractedPGDAS {
  razaoSocial: string;
  cnpjMatriz: string;
  periodoApuracao: string;
  valorDAS: number;
  dataVencimento: string | null;
  estabelecimentos: Estabelecimento[];
  receitasMensais: HistoricoMensal[];
  folhasMensais: HistoricoMensal[];
  impostosMensais: HistoricoMensal[];
  rbt12: number;
  folha12Meses: number;
  fatorR: number | null;
  anexoAplicado: string | null;
  isGuiaDASSimples: boolean;
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
    console.log("[AGENTE_2] Using Gemini File API with URI:", fileUri);
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

    console.log(`[AGENTE_2] Processing PGDAS document: ${nomeArquivo}`);
    console.log(`[AGENTE_2] Gemini file URI: ${documento.gemini_file_uri || 'NOT AVAILABLE'}`);

    const userPrompt = `Analise este documento PGDAS-D e extraia os dados estruturados:

Nome do arquivo: ${nomeArquivo}
Cliente: ${clienteInfo?.razao_social || "Não especificado"}
CNPJ: ${clienteInfo?.cnpj || "Não especificado"}
Período informado: ${documento.periodo || "Não especificado"}

Retorne um JSON com esta estrutura exata:
{
  "razaoSocial": "string",
  "cnpjMatriz": "string (apenas números)",
  "periodoApuracao": "MM/AAAA",
  "valorDAS": 0,
  "dataVencimento": "AAAA-MM-DD ou null",
  "estabelecimentos": [
    {
      "tipo": "MATRIZ",
      "cnpj": "string",
      "receitaBruta": 0,
      "aliquotaEfetiva": 0.0,
      "valorImposto": 0
    }
  ],
  "receitasMensais": [
    { "mes": "MM/AAAA", "valor": 0 }
  ],
  "folhasMensais": [
    { "mes": "MM/AAAA", "valor": 0 }
  ],
  "impostosMensais": [
    { "mes": "MM/AAAA", "valor": 0 }
  ],
  "rbt12": 0,
  "folha12Meses": 0,
  "fatorR": 0.0,
  "anexoAplicado": "III",
  "isGuiaDASSimples": false,
  "confianca": 0.85
}

NOTAS:
- Se for apenas Guia DAS (sem históricos), defina isGuiaDASSimples: true
- receitasMensais deve ter até 12 meses anteriores ao período de apuração
- fatorR = folha12Meses / rbt12 (se disponível)
- Se fatorR >= 0.28, anexoAplicado deve ser "III", senão "V" (para serviços)`;

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

    let extracted: ExtractedPGDAS;
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

    console.log("[AGENTE_2] Extracted PGDAS data:", extracted);

    // Calcular Fator R se não veio calculado
    if (!extracted.fatorR && extracted.rbt12 > 0 && extracted.folha12Meses > 0) {
      extracted.fatorR = extracted.folha12Meses / extracted.rbt12;
    }

    // Determinar anexo baseado no Fator R
    if (extracted.fatorR !== null && extracted.fatorR >= 0.28) {
      extracted.anexoAplicado = "III";
    } else if (extracted.fatorR !== null) {
      extracted.anexoAplicado = "V";
    }

    // Converter históricos para formato do banco
    const historicoReceitas = extracted.receitasMensais?.map(r => ({
      mes: r.mes,
      valor: r.valor
    })) || [];

    const historicoFolhas = extracted.folhasMensais?.map(f => ({
      mes: f.mes,
      valor: f.valor
    })) || [];

    const historicoImpostos = extracted.impostosMensais?.map(i => ({
      mes: i.mes,
      valor: i.valor
    })) || [];

    const estabelecimentos = extracted.estabelecimentos?.map(e => ({
      tipo: e.tipo,
      cnpj: e.cnpj,
      receita: e.receitaBruta,
      aliquota: e.aliquotaEfetiva,
      imposto: e.valorImposto
    })) || [];

    // Salvar dados extraídos
    const { error: upsertError } = await supabase
      .from("dados_extraidos")
      .upsert({
        documento_id: documentoId,
        cliente_id: documento.cliente_id,
        tipo_documento: "pgdas",
        competencia: extracted.periodoApuracao,
        valor_total: extracted.valorDAS,
        dados_pgdas: extracted,
        historico_receitas: historicoReceitas,
        historico_folhas: historicoFolhas,
        historico_impostos: historicoImpostos,
        estabelecimentos: estabelecimentos,
        fator_r_aplicado: extracted.fatorR,
        anexo_detectado: extracted.anexoAplicado,
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
        agente: "AGENTE_2_PGDAS",
        documentoId,
        usedFileApi: !!documento.gemini_file_uri,
        extracted: {
          periodo: extracted.periodoApuracao,
          valorDAS: extracted.valorDAS,
          rbt12: extracted.rbt12,
          fatorR: extracted.fatorR,
          anexo: extracted.anexoAplicado,
          qtdEstabelecimentos: extracted.estabelecimentos?.length || 0,
          qtdMesesReceita: extracted.receitasMensais?.length || 0,
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
