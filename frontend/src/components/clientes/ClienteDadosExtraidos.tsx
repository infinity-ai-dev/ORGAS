import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useDadosExtraidos, formatTipoDocumento, formatCurrency } from '@/hooks/useDadosExtraidos';
import { FileText, TrendingUp, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ClienteDadosExtraidosProps {
  clienteId: string;
}

export function ClienteDadosExtraidos({ clienteId }: ClienteDadosExtraidosProps) {
  const { data: dadosExtraidos, isLoading, error } = useDadosExtraidos(clienteId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Erro ao carregar dados extraídos
        </CardContent>
      </Card>
    );
  }

  // Group by competencia
  const groupedByCompetencia = dadosExtraidos?.reduce((acc, dado) => {
    const key = dado.competencia || 'Sem competência';
    if (!acc[key]) acc[key] = [];
    acc[key].push(dado);
    return acc;
  }, {} as Record<string, typeof dadosExtraidos>) || {};

  const competencias = Object.keys(groupedByCompetencia).sort().reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Dados Extraídos
        </CardTitle>
        <CardDescription>
          Histórico de documentos processados e dados extraídos por IA
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!dadosExtraidos || dadosExtraidos.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <p>Nenhum documento processado para este cliente</p>
          </div>
        ) : (
          <div className="space-y-6">
            {competencias.slice(0, 6).map(competencia => (
              <div key={competencia}>
                <div className="mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{competencia}</span>
                </div>
                <div className="space-y-2">
                  {groupedByCompetencia[competencia]?.map(dado => (
                    <div
                      key={dado.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">
                          {formatTipoDocumento(dado.tipo_documento)}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">
                            {formatCurrency(dado.valor_total)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Extraído em {dado.extraido_em
                              ? format(new Date(dado.extraido_em), "dd/MM/yyyy", { locale: ptBR })
                              : '-'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {Math.round((dado.confianca || 0) * 100)}% conf.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {competencias.length > 6 && (
              <p className="text-center text-sm text-muted-foreground">
                +{competencias.length - 6} competências anteriores
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
