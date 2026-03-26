-- Criar função de updated_at se não existir
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Criar enum para tipos de documento
CREATE TYPE public.tipo_documento AS ENUM (
  'nfe',
  'nfse', 
  'cte',
  'pgdas',
  'guia_federal',
  'guia_estadual',
  'guia_municipal',
  'extrato_bancario',
  'folha_pagamento',
  'contrato',
  'outros'
);

-- Tabela para armazenar dados extraídos
CREATE TABLE public.dados_extraidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID REFERENCES public.documentos(id) ON DELETE CASCADE NOT NULL,
  cliente_id UUID REFERENCES public.clientes_pj(id) ON DELETE CASCADE NOT NULL,
  tipo_documento tipo_documento NOT NULL,
  
  -- Campos comuns
  competencia TEXT,
  valor_total DECIMAL(15,2),
  
  -- Campos específicos por tipo (JSONB flexível)
  dados_nfe JSONB DEFAULT '{}'::jsonb,
  dados_nfse JSONB DEFAULT '{}'::jsonb,
  dados_pgdas JSONB DEFAULT '{}'::jsonb,
  dados_guia JSONB DEFAULT '{}'::jsonb,
  dados_extrato JSONB DEFAULT '{}'::jsonb,
  dados_folha JSONB DEFAULT '{}'::jsonb,
  
  -- Metadados de extração
  confianca DECIMAL(3,2) DEFAULT 0,
  extraido_em TIMESTAMPTZ DEFAULT now(),
  modelo_ia TEXT,
  tokens_usados INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX idx_dados_extraidos_documento ON public.dados_extraidos(documento_id);
CREATE INDEX idx_dados_extraidos_cliente ON public.dados_extraidos(cliente_id);
CREATE INDEX idx_dados_extraidos_tipo ON public.dados_extraidos(tipo_documento);
CREATE INDEX idx_dados_extraidos_competencia ON public.dados_extraidos(competencia);

-- RLS
ALTER TABLE public.dados_extraidos ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Usuarios autenticados podem ver dados extraidos"
  ON public.dados_extraidos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Sistema pode inserir dados extraidos"
  ON public.dados_extraidos FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Sistema pode atualizar dados extraidos"
  ON public.dados_extraidos FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admins podem deletar dados extraidos"
  ON public.dados_extraidos FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Atualizar tabela documentos com tipo classificado
ALTER TABLE public.documentos 
ADD COLUMN IF NOT EXISTS tipo_documento tipo_documento,
ADD COLUMN IF NOT EXISTS classificacao_metadata JSONB DEFAULT '{}'::jsonb;

-- Trigger para updated_at
CREATE TRIGGER update_dados_extraidos_updated_at
  BEFORE UPDATE ON public.dados_extraidos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();