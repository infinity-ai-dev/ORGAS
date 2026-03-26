import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  useHistoricoRevisoes, 
  acaoLabels, 
  acaoColors,
  AcaoRevisao 
} from '@/hooks/useHistoricoRevisoes';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History, MessageSquare } from 'lucide-react';

interface HistoricoRevisoesTimelineProps {
  relatorioId: string;
}

export function HistoricoRevisoesTimeline({ relatorioId }: HistoricoRevisoesTimelineProps) {
  const { data: historico, isLoading } = useHistoricoRevisoes(relatorioId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Histórico de Revisões
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!historico || historico.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Histórico de Revisões
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum histórico de revisão encontrado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de Revisões
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
          
          <div className="space-y-6">
            {historico.map((item, index) => {
              const acao = item.acao as AcaoRevisao;
              const colorClass = acaoColors[acao] || 'bg-gray-500';
              const initials = item.profiles?.full_name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase() || '??';

              return (
                <div key={item.id} className="relative flex gap-4 pl-10">
                  {/* Timeline dot */}
                  <div 
                    className={`absolute left-2.5 w-3 h-3 rounded-full ${colorClass} ring-4 ring-background`}
                  />
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={item.profiles?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {item.profiles?.full_name || 'Usuário'}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {acaoLabels[acao]}
                      </span>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(item.created_at), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { 
                        locale: ptBR 
                      })}
                    </p>
                    
                    {item.comentario && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 mt-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-sm">{item.comentario}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
