-- Adicionar constraint UNIQUE na coluna documento_id
-- Isso permite que o upsert com onConflict funcione corretamente

-- Primeiro, remover duplicatas se existirem (manter o mais recente)
DELETE FROM dados_extraidos a
USING dados_extraidos b
WHERE a.documento_id = b.documento_id 
  AND a.created_at < b.created_at;

-- Remover o índice não-único existente
DROP INDEX IF EXISTS idx_dados_extraidos_documento;

-- Adicionar constraint UNIQUE
ALTER TABLE dados_extraidos 
ADD CONSTRAINT dados_extraidos_documento_id_unique 
UNIQUE (documento_id);