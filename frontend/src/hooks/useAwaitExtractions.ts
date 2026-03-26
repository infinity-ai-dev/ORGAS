import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

interface ExtractionStatus {
  total: number;
  processed: number;
  pending: number;
  errors: number;
  isComplete: boolean;
}

/**
 * Hook para aguardar a conclusão das extrações de documentos.
 * Faz polling no banco de dados verificando o status dos documentos.
 */
export function useAwaitExtractions() {
  const [status, setStatus] = useState<ExtractionStatus>({
    total: 0,
    processed: 0,
    pending: 0,
    errors: 0,
    isComplete: false,
  });
  const [isWaiting, setIsWaiting] = useState(false);

  /**
   * Aguarda até que todos os documentos do cliente/período tenham sido processados.
   * @param clienteId - ID do cliente
   * @param ano - Ano da competência
   * @param mes - Mês da competência
   * @param maxAttempts - Número máximo de tentativas (default: 30 = 60 segundos)
   * @param intervalMs - Intervalo entre verificações em ms (default: 2000)
   */
  const awaitExtractions = useCallback(async (
    clienteId: string,
    ano: number,
    mes: number,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<ExtractionStatus> => {
    setIsWaiting(true);
    
    let attempts = 0;
    
    const checkStatus = async (): Promise<ExtractionStatus> => {
      // Buscar documentos do cliente/período
      const response = await apiFetch<{ documentos: { id: string; status: string }[] }>(
        `/documentos?cliente_id=${encodeURIComponent(clienteId)}&ano=${ano}&mes=${mes}`,
        { method: 'GET' }
      );
      const documentos = response.documentos || [];

      if (!documentos || documentos.length === 0) {
        console.log('[AwaitExtractions] Nenhum documento encontrado para processar');
        return {
          total: 0,
          processed: 0,
          pending: 0,
          errors: 0,
          isComplete: true,
        };
      }

      // Contar status
      const processed = documentos.filter(d => 
        d.status === 'processado' || d.status === 'classificado'
      ).length;
      const pending = documentos.filter(d => 
        d.status === 'pendente' || d.status === 'processando'
      ).length;
      const errors = documentos.filter(d => d.status === 'erro').length;
      const total = documentos.length;

      const currentStatus: ExtractionStatus = {
        total,
        processed,
        pending,
        errors,
        isComplete: pending === 0,
      };

      console.log(`[AwaitExtractions] Status: ${processed}/${total} processados, ${pending} pendentes, ${errors} erros`);
      setStatus(currentStatus);

      return currentStatus;
    };

    // Polling loop
    while (attempts < maxAttempts) {
      attempts++;
      
      const currentStatus = await checkStatus();
      
      if (currentStatus.isComplete) {
        console.log(`[AwaitExtractions] Extração concluída após ${attempts} tentativas`);
        setIsWaiting(false);
        return currentStatus;
      }

      // Aguardar antes da próxima verificação
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    // Timeout - retornar status atual mesmo incompleto
    console.warn(`[AwaitExtractions] Timeout após ${maxAttempts} tentativas`);
    const finalStatus = await checkStatus();
    setIsWaiting(false);
    return finalStatus;
  }, []);

  return {
    awaitExtractions,
    status,
    isWaiting,
  };
}
