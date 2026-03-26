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
import { Building2, Store, TrendingUp } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/hooks/useRelatorios';

interface Estabelecimento {
  tipo: string;
  cnpj: string;
  receita: number;
  aliquota: number;
  imposto: number;
}

interface SecaoFaturamentoData {
  receitaBrutaMes: number;
  rbt12: number;
  anexo: string;
  fatorR: number | null;
  anexoEfetivo: string;
  estabelecimentos: Estabelecimento[];
  aliquotaNominal: number;
  aliquotaEfetiva: number;
  deducao: number;
  impostoDevido: number;
}

interface SecaoFaturamentoProps {
  data: SecaoFaturamentoData;
  competencia: string;
}

export function SecaoFaturamento({ data, competencia }: SecaoFaturamentoProps) {
  const temEstabelecimentos = data.estabelecimentos && data.estabelecimentos.length > 0;
  const totalReceita = temEstabelecimentos
    ? data.estabelecimentos.reduce((sum, e) => sum + e.receita, 0)
    : data.receitaBrutaMes;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5" />
            Seção 1: Faturamento e Impostos
          </CardTitle>
          <Badge variant="outline">{competencia}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Resumo Principal */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">Receita do Mês</p>
            <p className="text-2xl font-bold">{formatCurrency(data.receitaBrutaMes)}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">RBT12</p>
            <p className="text-2xl font-bold">{formatCurrency(data.rbt12)}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">Anexo</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">{data.anexoEfetivo || data.anexo}</p>
              {data.fatorR !== null && data.fatorR >= 0.28 && (
                <Badge className="bg-green-500">Fator R</Badge>
              )}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-primary/10">
            <p className="text-sm text-muted-foreground">Imposto Devido</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(data.impostoDevido)}</p>
          </div>
        </div>

        {/* Alíquotas */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex justify-between items-center p-3 border rounded-lg">
            <span className="text-sm text-muted-foreground">Alíquota Nominal</span>
            <span className="font-semibold">{formatPercent(data.aliquotaNominal)}</span>
          </div>
          <div className="flex justify-between items-center p-3 border rounded-lg">
            <span className="text-sm text-muted-foreground">Dedução</span>
            <span className="font-semibold">{formatCurrency(data.deducao)}</span>
          </div>
          <div className="flex justify-between items-center p-3 border rounded-lg bg-primary/5">
            <span className="text-sm text-muted-foreground">Alíquota Efetiva</span>
            <span className="font-bold text-primary">{formatPercent(data.aliquotaEfetiva)}</span>
          </div>
        </div>

        {/* Fator R se aplicável */}
        {data.fatorR !== null && (
          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Fator R Calculado</p>
                <p className="text-sm text-muted-foreground">
                  Folha / RBT12 = {formatPercent(data.fatorR)}
                </p>
              </div>
              <div className="text-right">
                {data.fatorR >= 0.28 ? (
                  <Badge className="bg-green-500">Elegível Anexo III</Badge>
                ) : (
                  <Badge variant="secondary">Anexo V</Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabela de Estabelecimentos */}
        {temEstabelecimentos && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Receita por Estabelecimento
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Alíquota</TableHead>
                  <TableHead className="text-right">Imposto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.estabelecimentos.map((est, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {est.tipo === 'MATRIZ' ? (
                          <Building2 className="h-4 w-4 text-primary" />
                        ) : (
                          <Store className="h-4 w-4 text-muted-foreground" />
                        )}
                        <Badge variant={est.tipo === 'MATRIZ' ? 'default' : 'outline'}>
                          {est.tipo}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{est.cnpj}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(est.receita)}
                    </TableCell>
                    <TableCell className="text-right">{formatPercent(est.aliquota)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(est.imposto)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalReceita)}</TableCell>
                  <TableCell className="text-right">-</TableCell>
                  <TableCell className="text-right">{formatCurrency(data.impostoDevido)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
