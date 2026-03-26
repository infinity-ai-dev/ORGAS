-- Corrigir políticas permissivas - Apenas analistas e admins podem inserir/atualizar
DROP POLICY IF EXISTS "Sistema pode inserir dados extraidos" ON public.dados_extraidos;
DROP POLICY IF EXISTS "Sistema pode atualizar dados extraidos" ON public.dados_extraidos;

CREATE POLICY "Analistas e Admins podem inserir dados extraidos"
  ON public.dados_extraidos FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'analista') OR 
    public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Analistas e Admins podem atualizar dados extraidos"
  ON public.dados_extraidos FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista') OR 
    public.has_role(auth.uid(), 'admin')
  );