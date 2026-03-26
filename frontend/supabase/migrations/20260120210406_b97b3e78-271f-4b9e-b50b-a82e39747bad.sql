-- Criar tabela de histórico de revisões para audit trail
CREATE TABLE public.historico_revisoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relatorio_id UUID REFERENCES public.relatorios_fiscais(id) ON DELETE CASCADE NOT NULL,
  usuario_id UUID NOT NULL,
  acao TEXT NOT NULL, -- 'criado', 'enviado_aprovacao', 'aprovado', 'rejeitado', 'reaberto'
  status_anterior TEXT,
  status_novo TEXT NOT NULL,
  comentario TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.historico_revisoes ENABLE ROW LEVEL SECURITY;

-- Policies: Todos autenticados podem ver, analistas/admins podem inserir
CREATE POLICY "Usuarios autenticados podem ver historico"
  ON public.historico_revisoes
  FOR SELECT
  USING (true);

CREATE POLICY "Analistas e Admins podem inserir historico"
  ON public.historico_revisoes
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'analista'::app_role) OR 
    has_role(auth.uid(), 'revisor'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role)
  );

-- Index para buscas rápidas por relatório
CREATE INDEX idx_historico_revisoes_relatorio ON public.historico_revisoes(relatorio_id);
CREATE INDEX idx_historico_revisoes_created ON public.historico_revisoes(created_at DESC);