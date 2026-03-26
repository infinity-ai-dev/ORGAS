-- Tabela para relatórios consolidados
CREATE TABLE public.relatorios_fiscais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clientes_pj(id) ON DELETE CASCADE NOT NULL,
  competencia TEXT NOT NULL, -- MM/AAAA
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  
  -- Dados consolidados
  receita_bruta_mes DECIMAL(15,2) DEFAULT 0,
  receita_bruta_12_meses DECIMAL(15,2) DEFAULT 0,
  
  -- Totais por categoria
  total_notas_emitidas INTEGER DEFAULT 0,
  total_notas_recebidas INTEGER DEFAULT 0,
  valor_notas_emitidas DECIMAL(15,2) DEFAULT 0,
  valor_notas_recebidas DECIMAL(15,2) DEFAULT 0,
  
  -- Impostos calculados - Simples Nacional
  simples_anexo TEXT,
  simples_aliquota_efetiva DECIMAL(5,4) DEFAULT 0,
  simples_valor_devido DECIMAL(15,2) DEFAULT 0,
  simples_deducao DECIMAL(15,2) DEFAULT 0,
  
  -- Detalhamento tributos Simples
  simples_irpj DECIMAL(15,2) DEFAULT 0,
  simples_csll DECIMAL(15,2) DEFAULT 0,
  simples_cofins DECIMAL(15,2) DEFAULT 0,
  simples_pis DECIMAL(15,2) DEFAULT 0,
  simples_cpp DECIMAL(15,2) DEFAULT 0,
  simples_icms DECIMAL(15,2) DEFAULT 0,
  simples_iss DECIMAL(15,2) DEFAULT 0,
  
  -- Comparativo Lucro Presumido
  presumido_base_irpj DECIMAL(15,2) DEFAULT 0,
  presumido_irpj DECIMAL(15,2) DEFAULT 0,
  presumido_csll DECIMAL(15,2) DEFAULT 0,
  presumido_pis DECIMAL(15,2) DEFAULT 0,
  presumido_cofins DECIMAL(15,2) DEFAULT 0,
  presumido_iss DECIMAL(15,2) DEFAULT 0,
  presumido_total DECIMAL(15,2) DEFAULT 0,
  
  -- Folha de pagamento
  folha_total_bruto DECIMAL(15,2) DEFAULT 0,
  folha_encargos DECIMAL(15,2) DEFAULT 0,
  
  -- Guias pagas
  guias_federais DECIMAL(15,2) DEFAULT 0,
  guias_estaduais DECIMAL(15,2) DEFAULT 0,
  guias_municipais DECIMAL(15,2) DEFAULT 0,
  
  -- Status do relatório
  status TEXT DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado')),
  aprovado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovado_em TIMESTAMPTZ,
  observacoes TEXT,
  
  -- Metadados
  documentos_processados INTEGER DEFAULT 0,
  gerado_em TIMESTAMPTZ DEFAULT now(),
  modelo_ia TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(cliente_id, competencia)
);

-- Índices
CREATE INDEX idx_relatorios_cliente ON public.relatorios_fiscais(cliente_id);
CREATE INDEX idx_relatorios_competencia ON public.relatorios_fiscais(competencia);
CREATE INDEX idx_relatorios_ano_mes ON public.relatorios_fiscais(ano, mes);
CREATE INDEX idx_relatorios_status ON public.relatorios_fiscais(status);

-- RLS
ALTER TABLE public.relatorios_fiscais ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Usuarios autenticados podem ver relatorios"
  ON public.relatorios_fiscais FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Analistas e Admins podem criar relatorios"
  ON public.relatorios_fiscais FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'analista') OR 
    public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Analistas e Admins podem atualizar relatorios"
  ON public.relatorios_fiscais FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista') OR 
    public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins podem deletar relatorios"
  ON public.relatorios_fiscais FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger para updated_at
CREATE TRIGGER update_relatorios_fiscais_updated_at
  BEFORE UPDATE ON public.relatorios_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();