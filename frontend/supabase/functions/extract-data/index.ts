import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapeamento de tipos de documento
const TIPO_MAP: Record<string, string> = {
  "NF-e": "nfe",
  "NFS-e": "nfse",
  "CT-e": "cte",
  "PGDAS": "pgdas",
  "DARF": "guia_federal",
  "GPS": "guia_federal",
  "FGTS": "guia_federal",
  "ICMS": "guia_estadual",
  "ISS": "guia_municipal",
  "Extrato Bancário": "extrato_bancario",
  "Folha de Pagamento": "folha_pagamento",
  "Contrato": "contrato",
};

// Prompts especializados por tipo
const EXTRACTION_PROMPTS: Record<string, { system: string; fields: string }> = {
  nfe: {
    system: `Você é um especialista em extração de dados de Notas Fiscais Eletrônicas (NF-e) brasileiras.
Extraia com precisão todos os dados relevantes do documento.`,
    fields: `{
  "numero_nfe": "string",
  "serie": "string",
  "chave_acesso": "string (44 dígitos)",
  "data_emissao": "YYYY-MM-DD",
  "data_saida": "YYYY-MM-DD ou null",
  "emitente": {
    "cnpj": "string",
    "razao_social": "string",
    "inscricao_estadual": "string"
  },
  "destinatario": {
    "cnpj_cpf": "string",
    "razao_social": "string",
    "inscricao_estadual": "string ou null"
  },
  "produtos": [{
    "codigo": "string",
    "descricao": "string",
    "ncm": "string",
    "cfop": "string",
    "unidade": "string",
    "quantidade": number,
    "valor_unitario": number,
    "valor_total": number
  }],
  "totais": {
    "base_calculo_icms": number,
    "valor_icms": number,
    "base_calculo_icms_st": number,
    "valor_icms_st": number,
    "valor_produtos": number,
    "valor_frete": number,
    "valor_seguro": number,
    "valor_desconto": number,
    "valor_ipi": number,
    "valor_pis": number,
    "valor_cofins": number,
    "valor_total_nota": number
  }
}`
  },
  nfse: {
    system: `Você é um especialista em extração de dados de Notas Fiscais de Serviços Eletrônicas (NFS-e) brasileiras.
Extraia com precisão todos os dados relevantes do documento.`,
    fields: `{
  "numero_nfse": "string",
  "codigo_verificacao": "string",
  "data_emissao": "YYYY-MM-DD",
  "competencia": "MM/AAAA",
  "prestador": {
    "cnpj": "string",
    "razao_social": "string",
    "inscricao_municipal": "string"
  },
  "tomador": {
    "cnpj_cpf": "string",
    "razao_social": "string"
  },
  "servico": {
    "codigo_servico": "string",
    "discriminacao": "string",
    "codigo_cnae": "string"
  },
  "valores": {
    "valor_servico": number,
    "valor_deducoes": number,
    "base_calculo": number,
    "aliquota_iss": number,
    "valor_iss": number,
    "valor_iss_retido": number,
    "valor_pis": number,
    "valor_cofins": number,
    "valor_inss": number,
    "valor_ir": number,
    "valor_csll": number,
    "valor_liquido": number
  }
}`
  },
  pgdas: {
    system: `Você é um especialista em extração de dados do PGDAS-D (Programa Gerador do Documento de Arrecadação do Simples Nacional).
Extraia com precisão todos os dados do documento.`,
    fields: `{
  "periodo_apuracao": "MM/AAAA",
  "cnpj": "string",
  "razao_social": "string",
  "receita_bruta_total": number,
  "receita_bruta_12_meses": number,
  "anexo": "I, II, III, IV ou V",
  "atividades": [{
    "descricao": "string",
    "receita": number,
    "aliquota_efetiva": number,
    "valor_devido": number
  }],
  "tributos": {
    "irpj": number,
    "csll": number,
    "cofins": number,
    "pis": number,
    "cpp": number,
    "icms": number,
    "iss": number
  },
  "valor_total_devido": number,
  "numero_das": "string",
  "data_vencimento": "YYYY-MM-DD"
}`
  },
  guia_federal: {
    system: `Você é um especialista em extração de dados de guias de recolhimento federais (DARF, GPS, FGTS).
Extraia com precisão todos os dados do documento.`,
    fields: `{
  "tipo_guia": "DARF, GPS, FGTS ou outro",
  "periodo_apuracao": "MM/AAAA",
  "data_vencimento": "YYYY-MM-DD",
  "data_pagamento": "YYYY-MM-DD ou null",
  "cnpj_cpf": "string",
  "codigo_receita": "string",
  "numero_referencia": "string ou null",
  "valor_principal": number,
  "valor_multa": number,
  "valor_juros": number,
  "valor_total": number,
  "banco": "string ou null",
  "autenticacao": "string ou null"
}`
  },
  extrato_bancario: {
    system: `Você é um especialista em extração de dados de extratos bancários.
Extraia com precisão todos os movimentos e totais do extrato.`,
    fields: `{
  "banco": "string",
  "agencia": "string",
  "conta": "string",
  "titular": "string",
  "periodo": {
    "inicio": "YYYY-MM-DD",
    "fim": "YYYY-MM-DD"
  },
  "saldo_anterior": number,
  "movimentos": [{
    "data": "YYYY-MM-DD",
    "descricao": "string",
    "tipo": "credito ou debito",
    "valor": number,
    "saldo": number
  }],
  "totais": {
    "total_creditos": number,
    "total_debitos": number,
    "saldo_final": number
  }
}`
  },
  folha_pagamento: {
    system: `Você é um especialista em extração de dados de folha de pagamento.
Extraia com precisão os dados consolidados da folha.`,
    fields: `{
  "competencia": "MM/AAAA",
  "cnpj_empresa": "string",
  "razao_social": "string",
  "quantidade_funcionarios": number,
  "resumo": {
    "total_proventos": number,
    "total_descontos": number,
    "total_liquido": number,
    "total_encargos": number
  },
  "encargos": {
    "inss_patronal": number,
    "inss_funcionario": number,
    "fgts": number,
    "irrf": number,
    "pis_folha": number
  },
  "funcionarios": [{
    "nome": "string",
    "cargo": "string",
    "salario_base": number,
    "total_proventos": number,
    "total_descontos": number,
    "liquido": number
  }]
}`
  }
};

async function callGemini(systemPrompt: string, userPrompt: string, temperature = 0.2): Promise<{ content: string; tokensUsed: number }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

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
            parts: [{ text: userPrompt }]
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

    // Determinar tipo para extração
    const tipoExtracao = TIPO_MAP[tipoClassificado] || "outros";
    const extractionConfig = EXTRACTION_PROMPTS[tipoExtracao];

    if (!extractionConfig) {
      console.log(`No extraction config for type: ${tipoExtracao}`);
      // Marcar documento como processado mesmo sem extração específica
      await supabase
        .from("documentos")
        .update({ status: "processado", tipo_documento: tipoExtracao })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No specific extraction for this document type",
          tipo: tipoExtracao 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracting data for document ${documentoId}, type: ${tipoExtracao}`);

    // Atualizar status para processando
    await supabase
      .from("documentos")
      .update({ status: "processando", tipo_documento: tipoExtracao })
      .eq("id", documentoId);

    // Buscar documento
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

    const userPrompt = `Analise o documento e extraia os dados no formato JSON especificado.

Informações do documento:
- Nome do arquivo: ${nomeArquivo || documento.nome_original}
- Tipo identificado: ${tipoClassificado}
- Cliente: ${clienteInfo?.razao_social || "Não especificado"}
- CNPJ do Cliente: ${clienteInfo?.cnpj || "Não especificado"}
- Período: ${documento.periodo || "Não especificado"}

Retorne APENAS um JSON válido com a seguinte estrutura:
${extractionConfig.fields}

Se algum campo não estiver disponível, use null para strings e 0 para números.`;

    let content: string;
    let tokensUsed: number;
    
    try {
      const result = await callGemini(extractionConfig.system, userPrompt, 0.2);
      content = result.content;
      tokensUsed = result.tokensUsed;
    } catch (error) {
      console.error("AI error:", error);
      await supabase
        .from("documentos")
        .update({ 
          status: "erro", 
          erro_mensagem: `Erro na extração: ${error instanceof Error ? error.message : 'Unknown'}` 
        })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "AI extraction failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!content) {
      console.error("No content in AI response");
      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Resposta vazia da IA" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Empty AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON
    let extractedData: Record<string, unknown>;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1]?.trim() || content.trim();
      extractedData = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Error parsing AI response:", parseError);
      await supabase
        .from("documentos")
        .update({ status: "erro", erro_mensagem: "Erro ao interpretar resposta da IA" })
        .eq("id", documentoId);

      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Extracted data:", JSON.stringify(extractedData).substring(0, 500));

    // Determinar competência e valor total
    let competencia = documento.periodo;
    let valorTotal = 0;

    if (tipoExtracao === "nfe" || tipoExtracao === "nfse") {
      valorTotal = (extractedData as any).totais?.valor_total_nota || 
                   (extractedData as any).valores?.valor_liquido || 0;
      competencia = (extractedData as any).competencia || documento.periodo;
    } else if (tipoExtracao === "pgdas") {
      valorTotal = (extractedData as any).valor_total_devido || 0;
      competencia = (extractedData as any).periodo_apuracao || documento.periodo;
    } else if (tipoExtracao === "guia_federal") {
      valorTotal = (extractedData as any).valor_total || 0;
      competencia = (extractedData as any).periodo_apuracao || documento.periodo;
    } else if (tipoExtracao === "extrato_bancario") {
      valorTotal = (extractedData as any).totais?.saldo_final || 0;
    } else if (tipoExtracao === "folha_pagamento") {
      valorTotal = (extractedData as any).resumo?.total_liquido || 0;
      competencia = (extractedData as any).competencia || documento.periodo;
    }

    // Preparar dados para inserção
    const dadosColumn = `dados_${tipoExtracao}`;
    const insertData: Record<string, unknown> = {
      documento_id: documentoId,
      cliente_id: documento.cliente_id,
      tipo_documento: tipoExtracao,
      competencia,
      valor_total: valorTotal,
      confianca: 0.85,
      modelo_ia: "gemini-2.5-pro",
      tokens_usados: tokensUsed,
    };

    // Adicionar dados no campo JSONB correto
    if (["nfe", "nfse", "pgdas", "guia", "extrato", "folha"].includes(tipoExtracao)) {
      insertData[dadosColumn] = extractedData;
    }

    // Inserir dados extraídos
    const { error: insertError } = await supabase
      .from("dados_extraidos")
      .insert(insertData);

    if (insertError) {
      console.error("Error inserting extracted data:", insertError);
      // Não falhar completamente, apenas logar
    }

    // Atualizar documento como processado
    await supabase
      .from("documentos")
      .update({ 
        status: "processado",
        tipo_documento: tipoExtracao,
        classificacao_metadata: { extractedAt: new Date().toISOString() }
      })
      .eq("id", documentoId);

    return new Response(
      JSON.stringify({
        success: true,
        documentoId,
        tipo: tipoExtracao,
        competencia,
        valorTotal,
        tokensUsed,
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
