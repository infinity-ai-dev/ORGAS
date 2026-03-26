import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquareText, User, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SecaoComentarioAnalistaData {
  titulo?: string;
  comentario?: string;
  analista?: string;
  dataComentario?: string | null;
}

interface SecaoComentarioAnalistaProps {
  data: SecaoComentarioAnalistaData;
}

export function SecaoComentarioAnalista({ data }: SecaoComentarioAnalistaProps) {
  const comentario = data.comentario?.trim();
  const parsedDate = data.dataComentario ? new Date(data.dataComentario) : null;
  const hasValidDate = parsedDate !== null && !Number.isNaN(parsedDate.getTime());
  if (!comentario) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquareText className="h-5 w-5" />
          {data.titulo || 'Seção 9: Comentário do Analista'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm whitespace-pre-wrap text-foreground">{comentario}</p>
        </div>

        {(data.analista || data.dataComentario) && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {data.analista && (
              <span className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {data.analista}
              </span>
            )}
            {hasValidDate && (
              <Badge variant="outline" className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                {format(parsedDate as Date, "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
