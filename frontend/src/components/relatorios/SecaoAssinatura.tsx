import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PenTool, User, Calendar, Building2, FileCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SecaoAssinaturaData {
  empresa: {
    razaoSocial: string;
    cnpj: string;
  };
  responsavel: {
    nome: string;
    cargo: string;
    crc?: string;
  };
  dataEmissao: string;
  dataAprovacao?: string;
  aprovadoPor?: string;
  observacoes?: string;
}

interface SecaoAssinaturaProps {
  data: SecaoAssinaturaData;
}

export function SecaoAssinatura({ data }: SecaoAssinaturaProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <PenTool className="h-5 w-5" />
          Seção 8: Assinatura e Responsabilidade
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Informações da Empresa */}
        <div className="p-4 rounded-lg bg-muted/30 border">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Empresa Analisada</h4>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Razão Social</p>
              <p className="font-medium">{data.empresa.razaoSocial}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">CNPJ</p>
              <p className="font-mono">{data.empresa.cnpj}</p>
            </div>
          </div>
        </div>

        {/* Responsável Técnico */}
        <div className="p-4 rounded-lg bg-muted/30 border">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Responsável Técnico</h4>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Nome</p>
              <p className="font-medium">{data.responsavel.nome}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cargo</p>
              <p>{data.responsavel.cargo}</p>
            </div>
            {data.responsavel.crc && (
              <div>
                <p className="text-sm text-muted-foreground">CRC</p>
                <p className="font-mono">{data.responsavel.crc}</p>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Datas */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3 p-3 rounded-lg border">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Data de Emissão</p>
              <p className="font-medium">
                {format(new Date(data.dataEmissao), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
          
          {data.dataAprovacao && (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-500/10 border-green-500/30">
              <FileCheck className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Aprovado em</p>
                <p className="font-medium text-green-600">
                  {format(new Date(data.dataAprovacao), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
                </p>
                {data.aprovadoPor && (
                  <p className="text-xs text-muted-foreground">por {data.aprovadoPor}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Observações */}
        {data.observacoes && (
          <div className="p-4 rounded-lg bg-muted/30 border">
            <h4 className="font-semibold mb-2">Observações</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {data.observacoes}
            </p>
          </div>
        )}

        {/* Declaração */}
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Declaro que as informações contidas neste parecer fiscal foram elaboradas com base nos documentos
            fornecidos pelo cliente e estão em conformidade com a legislação tributária vigente.
          </p>
          <div className="inline-block border-t-2 border-primary pt-2 px-8">
            <p className="font-medium">{data.responsavel.nome}</p>
            <p className="text-sm text-muted-foreground">{data.responsavel.cargo}</p>
            {data.responsavel.crc && (
              <Badge variant="outline" className="mt-1">CRC: {data.responsavel.crc}</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
