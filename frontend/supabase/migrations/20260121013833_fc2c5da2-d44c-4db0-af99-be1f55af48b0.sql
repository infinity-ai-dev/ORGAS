-- Adicionar campos de tipo ao relatório
ALTER TABLE public.relatorios_fiscais
ADD COLUMN IF NOT EXISTS tipo_relatorio text DEFAULT 'parecer',
ADD COLUMN IF NOT EXISTS tipo_parecer text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS regime_tributario_selecionado text DEFAULT NULL;

-- Comentários para documentação
COMMENT ON COLUMN public.relatorios_fiscais.tipo_relatorio IS 'Tipo: parecer, contrato, acordo, interacao';
COMMENT ON COLUMN public.relatorios_fiscais.tipo_parecer IS 'Subtipo do parecer: fiscal, contabil, pessoal, atendimento';
COMMENT ON COLUMN public.relatorios_fiscais.regime_tributario_selecionado IS 'Regime selecionado: simples_nacional, simples_fator_r, lucro_real, lucro_presumido';