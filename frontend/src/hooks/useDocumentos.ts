import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';

export interface DocumentoPayload {
  name: string;
  content: string;
  mimeType: string;
  size?: number;
  documentoTipo?: string;
}

export interface EnviarDocumentosParams {
  documents: DocumentoPayload[];
  clientId: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
  cliente_nome?: string;
  cliente_cnpj?: string;
  cliente_regime_tributario?: string;
  cliente_corp_group?: string;
  categoria?: string;
  competencia?: string;
  relatorio_type?: string;
  tipo_parecer?: string;
  is_parecer?: boolean;
  fiscal_tributation?: string;
  observacoes?: string;
  documentos_pendentes?: Array<{ key: string; tipo: string; motivo: string }>;
  analista_nome?: string;
  analista_email?: string;
  reportId?: number;
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result) {
        reject(new Error('Falha ao ler arquivo'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export function useEnviarDocumentos() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: EnviarDocumentosParams) => {
      const response = await apiFetch('/webhook/ai-submit', {
        method: 'POST',
        body: payload
      });
      return response as { reportId: number; taskId?: string };
    },
    onSuccess: () => {
      toast({
        title: 'Documentos enviados',
        description: 'Análise iniciada pelo agente interno.'
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Erro ao enviar documentos',
        description: error.message,
      });
    },
  });
}
