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
import { FileText, Receipt, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/hooks/useRelatorios';

interface ImpostosRetidos {
  iss: number;
  irrf: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
}

interface SecaoDocumentosData {
  totalNotasEmitidas: number;
  valorNotasEmitidas: number;
  totalNotasCanceladas: number;
  valorNotasCanceladas: number;
  totalNotasRecebidas: number;
  valorNotasRecebidas: number;
  impostos_retidos: ImpostosRetidos;
  totalRetido: number;
  comprasMes: number;
}

interface SecaoDocumentosProps {
  data: SecaoDocumentosData;
}

export function SecaoDocumentos({ data }: SecaoDocumentosProps) {
  const temRetencoes = data.totalRetido > 0;
  const temCanceladas = data.totalNotasCanceladas > 0;

  const retencoes = [
    { tributo: 'ISS', valor: data.impostos_retidos?.iss || 0 },
    { tributo: 'IRRF', valor: data.impostos_retidos?.irrf || 0 },
    { tributo: 'PIS', valor: data.impostos_retidos?.pis || 0 },
    { tributo: 'COFINS', valor: data.impostos_retidos?.cofins || 0 },
    { tributo: 'CSLL', valor: data.impostos_retidos?.csll || 0 },
    { tributo: 'INSS', valor: data.impostos_retidos?.inss || 0 },
  ].filter(r => r.valor > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          Seção 3: Documentos Fiscais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cards de Resumo */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="h-4 w-4 text-green-500" />
              <p className="text-sm text-muted-foreground">Notas Emitidas</p>
            </div>
            <p className="text-2xl font-bold">{data.totalNotasEmitidas}</p>
            <p className="text-sm text-muted-foreground">{formatCurrency(data.valorNotasEmitidas)}</p>
          </div>
          <div className={`p-4 rounded-lg ${temCanceladas ? 'bg-yellow-500/10' : 'bg-muted/50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {temCanceladas && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
              <p className="text-sm text-muted-foreground">Notas Canceladas</p>
            </div>
            <p className={`text-2xl font-bold ${temCanceladas ? 'text-yellow-600' : ''}`}>
              {data.totalNotasCanceladas}
            </p>
            <p className="text-sm text-muted-foreground">{formatCurrency(data.valorNotasCanceladas)}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="h-4 w-4 text-blue-500" />
              <p className="text-sm text-muted-foreground">Notas Recebidas</p>
            </div>
            <p className="text-2xl font-bold">{data.totalNotasRecebidas}</p>
            <p className="text-sm text-muted-foreground">{formatCurrency(data.valorNotasRecebidas)}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">Compras do Mês</p>
            <p className="text-2xl font-bold">{formatCurrency(data.comprasMes)}</p>
          </div>
        </div>

        {/* Tabela de Impostos Retidos */}
        {temRetencoes && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Impostos Retidos nas Notas
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tributo</TableHead>
                  <TableHead className="text-right">Valor Retido</TableHead>
                  <TableHead className="text-right">% do Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retencoes.map((ret, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Badge variant="outline">{ret.tributo}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(ret.valor)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {data.totalRetido > 0 ? ((ret.valor / data.totalRetido) * 100).toFixed(1) : 0}%
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>Total Retido</TableCell>
                  <TableCell className="text-right">{formatCurrency(data.totalRetido)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground mt-2">
              * Valores já deduzidos do imposto a pagar no Simples Nacional
            </p>
          </div>
        )}

        {/* Alerta de Notas Canceladas */}
        {temCanceladas && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <p className="text-sm font-medium text-yellow-600">
                {data.totalNotasCanceladas} nota(s) cancelada(s) no período, totalizando {formatCurrency(data.valorNotasCanceladas)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
