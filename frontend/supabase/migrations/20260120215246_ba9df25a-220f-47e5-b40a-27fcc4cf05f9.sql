-- Inserir cliente de teste para validar fluxo
INSERT INTO public.clientes_pj (
  id, 
  razao_social, 
  cnpj, 
  nome_fantasia, 
  regime_tributario, 
  anexo_simples, 
  cnae_principal,
  email,
  telefone
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'EMPRESA TESTE LTDA',
  '12.345.678/0001-90',
  'TESTE',
  'simples_nacional',
  'III',
  '6201-5/00',
  'teste@teste.com',
  '11999999999'
) ON CONFLICT (id) DO NOTHING;

-- Inserir documentos de teste primeiro (UUIDs válidos)
INSERT INTO public.documentos (
  id, cliente_id, nome_arquivo, nome_original, storage_path, tipo_mime, tamanho_bytes, tipo_documento, status, periodo, mes, ano
) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'pgdas_01_2026.pdf', 'PGDAS Janeiro 2026', 'uploads/pgdas_01_2026.pdf', 'application/pdf', 102400, 'pgdas', 'processado', '01/2026', 1, 2026),
  ('22222222-2222-2222-2222-222222222222', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'nfse_12345.pdf', 'NFS-e 12345', 'uploads/nfse_12345.pdf', 'application/pdf', 51200, 'nfse', 'processado', '01/2026', 1, 2026),
  ('33333333-3333-3333-3333-333333333333', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'folha_01_2026.pdf', 'Folha Janeiro 2026', 'uploads/folha_01_2026.pdf', 'application/pdf', 76800, 'folha_pagamento', 'processado', '01/2026', 1, 2026)
ON CONFLICT (id) DO NOTHING;

-- Inserir dados extraídos de teste simulando PGDAS
INSERT INTO public.dados_extraidos (
  id,
  documento_id,
  cliente_id,
  tipo_documento,
  competencia,
  valor_total,
  confianca,
  dados_pgdas,
  historico_receitas,
  historico_folhas,
  historico_impostos,
  estabelecimentos,
  fator_r_aplicado,
  anexo_detectado
) VALUES (
  'b2c3d4e5-f6a7-8901-bcde-f23456789012',
  '11111111-1111-1111-1111-111111111111',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'pgdas',
  '01/2026',
  15000.00,
  0.95,
  '{"valorDAS": 1500, "periodo": "01/2026", "anexo": "III", "rbt12": 180000}'::jsonb,
  '[{"mes": "12/2025", "valor": 45000}, {"mes": "11/2025", "valor": 42000}, {"mes": "10/2025", "valor": 48000}, {"mes": "09/2025", "valor": 40000}, {"mes": "08/2025", "valor": 38000}, {"mes": "07/2025", "valor": 35000}, {"mes": "06/2025", "valor": 32000}, {"mes": "05/2025", "valor": 30000}, {"mes": "04/2025", "valor": 28000}, {"mes": "03/2025", "valor": 25000}, {"mes": "02/2025", "valor": 22000}, {"mes": "01/2025", "valor": 20000}]'::jsonb,
  '[{"mes": "12/2025", "valor": 15000}, {"mes": "11/2025", "valor": 15000}]'::jsonb,
  '[{"mes": "12/2025", "valor": 2700}, {"mes": "11/2025", "valor": 2520}]'::jsonb,
  '[{"tipo": "MATRIZ", "cnpj": "12.345.678/0001-90", "receita": 45000, "aliquota": 0.06, "imposto": 2700}]'::jsonb,
  0.32,
  'III'
) ON CONFLICT (id) DO NOTHING;

-- Inserir NFS-e de teste
INSERT INTO public.dados_extraidos (
  id,
  documento_id,
  cliente_id,
  tipo_documento,
  competencia,
  valor_total,
  confianca,
  dados_nfse,
  impostos_retidos
) VALUES (
  'c3d4e5f6-a7b8-9012-cdef-345678901234',
  '22222222-2222-2222-2222-222222222222',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'nfse',
  '01/2026',
  25000.00,
  0.92,
  '{"numero": "12345", "prestador": {"cnpj": "12345678000190", "razaoSocial": "EMPRESA TESTE LTDA"}, "tomador": {"cnpj": "98765432000100"}, "servico": "Consultoria", "valorTotal": 25000}'::jsonb,
  '{"iss": 500, "irrf": 375, "pis": 162.50, "cofins": 750}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Inserir folha de pagamento de teste
INSERT INTO public.dados_extraidos (
  id,
  documento_id,
  cliente_id,
  tipo_documento,
  competencia,
  valor_total,
  confianca,
  dados_folha
) VALUES (
  'd4e5f6a7-b8c9-0123-defa-456789012345',
  '33333333-3333-3333-3333-333333333333',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'folha_pagamento',
  '01/2026',
  15000.00,
  0.88,
  '{"resumo": {"total_bruto": 15000, "total_liquido": 12500, "total_encargos": 4500, "funcionarios": 5}}'::jsonb
) ON CONFLICT (id) DO NOTHING;