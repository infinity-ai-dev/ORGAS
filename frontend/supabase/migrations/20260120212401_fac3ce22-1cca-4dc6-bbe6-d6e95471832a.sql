-- Adicionar colunas para históricos e estabelecimentos em dados_extraidos
ALTER TABLE public.dados_extraidos 
ADD COLUMN IF NOT EXISTS historico_receitas JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS historico_folhas JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS historico_impostos JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS estabelecimentos JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS impostos_retidos JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS compras_mes JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS vendas_cartao JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS pix_recebidos JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS transferencias JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS fator_r_aplicado NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS anexo_detectado TEXT DEFAULT NULL;

-- Adicionar colunas para as 8 seções do parecer em relatorios_fiscais
ALTER TABLE public.relatorios_fiscais
ADD COLUMN IF NOT EXISTS secao1_faturamento JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS secao2_financeiro JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS secao3_documentos JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS secao4_tabela_mensal JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS secao5_acompanham JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS secao6_analisados JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS secao7_tributaria JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS secao8_assinatura JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS alertas JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS rbt12_calculado NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS fator_r NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS anexo_efetivo TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS economia_vs_presumido NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_impostos_retidos NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_compras NUMERIC DEFAULT 0;