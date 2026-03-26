import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileSearch, CheckCircle, AlertTriangle, XCircle, FileText, Receipt, Building } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DocumentoAnalisado {
  nome: string;
  tipo: string;
  status: 'processado' | 'erro' | 'pendente';
  confianca: number;
  dataProcessamento: string;
}

interface DocumentoAcompanha {
  nome: string;
  obrigatorio: boolean;
  presente: boolean;
}

interface SecaoDocumentosAnalisadosProps {
  analisados: DocumentoAnalisado[];
  acompanham: DocumentoAcompanha[];
}

const tipoIcons: Record<string, typeof FileText> = {
  nfe: Receipt,
  nfse: Receipt,
  pgdas: FileText,
  folha: FileText,
  extrato: Building,
};

const statusConfig = {
  processado: { label: 'Processado', variant: 'default' as const, icon: CheckCircle, color: 'text-green-500' },
  erro: { label: 'Erro', variant: 'destructive' as const, icon: XCircle, color: 'text-destructive' },
  pendente: { label: 'Pendente', variant: 'secondary' as const, icon: AlertTriangle, color: 'text-yellow-500' },
};

export function SecaoDocumentosAnalisados({ analisados, acompanham }: SecaoDocumentosAnalisadosProps) {
  const processados = analisados.filter(d => d.status === 'processado').length;
  const erros = analisados.filter(d => d.status === 'erro').length;
  const pendentes = analisados.filter(d => d.status === 'pendente').length;
  
  const docsFaltando = acompanham.filter(d => d.obrigatorio && !d.presente);

  return (
    <div className="space-y-6">
      {/* Seção 5: Documentos que Acompanham */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Seção 5: Documentos Necessários
          </CardTitle>
        </CardHeader>
        <CardContent>
          {docsFaltando.length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-center gap-2 text-yellow-600">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {docsFaltando.length} documento(s) obrigatório(s) ausente(s)
                </span>
              </div>
            </div>
          )}
          
          <div className="grid gap-2 md:grid-cols-2">
            {acompanham.map((doc, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  !doc.presente && doc.obrigatorio
                    ? 'bg-yellow-500/10 border-yellow-500/30'
                    : doc.presente
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  {doc.presente ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : doc.obrigatorio ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">{doc.nome}</span>
                </div>
                <Badge variant={doc.obrigatorio ? 'default' : 'outline'}>
                  {doc.obrigatorio ? 'Obrigatório' : 'Opcional'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Seção 6: Documentos Analisados */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileSearch className="h-5 w-5" />
              Seção 6: Documentos Analisados
            </CardTitle>
            <div className="flex gap-2">
              <Badge variant="default">{processados} Processados</Badge>
              {erros > 0 && <Badge variant="destructive">{erros} Erros</Badge>}
              {pendentes > 0 && <Badge variant="secondary">{pendentes} Pendentes</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Confiança</TableHead>
                <TableHead className="text-right">Processado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analisados.map((doc, index) => {
                const status = statusConfig[doc.status];
                const StatusIcon = status.icon;
                const TipoIcon = tipoIcons[doc.tipo.toLowerCase()] || FileText;
                
                return (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <TipoIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium truncate max-w-[200px]">{doc.nome}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{doc.tipo.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <StatusIcon className={`h-4 w-4 ${status.color}`} />
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-medium ${
                        doc.confianca >= 0.9 ? 'text-green-600' :
                        doc.confianca >= 0.7 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {(doc.confianca * 100).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {format(new Date(doc.dataProcessamento), 'dd/MM/yy HH:mm', { locale: ptBR })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
