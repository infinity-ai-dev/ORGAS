-- Adicionar colunas para armazenar informações do Gemini File API
ALTER TABLE public.documentos 
ADD COLUMN IF NOT EXISTS gemini_file_uri TEXT,
ADD COLUMN IF NOT EXISTS gemini_file_name TEXT;

-- Adicionar comentário explicativo
COMMENT ON COLUMN public.documentos.gemini_file_uri IS 'URI do arquivo no Gemini File API para análise visual';
COMMENT ON COLUMN public.documentos.gemini_file_name IS 'Nome do arquivo no Gemini File API (formato: files/xxxx)';