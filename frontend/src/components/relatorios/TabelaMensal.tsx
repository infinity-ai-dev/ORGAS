import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/hooks/useRelatorios';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';

interface DadoMensal {
  mes: string;
  receita: number;
  imposto: number;
  folha: number;
  compras: number;
  lucro: number;
}

interface TabelaMensalProps {
  dados: DadoMensal[];
  mesAtual: string;
}

const chartConfig = {
  receita: { label: 'Receita', color: 'hsl(var(--primary))' },
  imposto: { label: 'Imposto', color: 'hsl(var(--destructive))' },
  lucro: { label: 'Lucro', color: 'hsl(142, 76%, 36%)' },
};

export function TabelaMensal({ dados, mesAtual }: TabelaMensalProps) {
  const dadosOrdenados = [...dados].sort((a, b) => {
    const [mesA, anoA] = a.mes.split('/').map(Number);
    const [mesB, anoB] = b.mes.split('/').map(Number);
    return anoA * 12 + mesA - (anoB * 12 + mesB);
  });

  const totalReceita = dadosOrdenados.reduce((sum, d) => sum + d.receita, 0);
  const totalImposto = dadosOrdenados.reduce((sum, d) => sum + d.imposto, 0);
  const totalFolha = dadosOrdenados.reduce((sum, d) => sum + d.folha, 0);
  const totalCompras = dadosOrdenados.reduce((sum, d) => sum + d.compras, 0);
  const totalLucro = dadosOrdenados.reduce((sum, d) => sum + d.lucro, 0);

  // Dados para o gráfico
  const chartData = dadosOrdenados.map(d => ({
    name: d.mes,
    receita: d.receita,
    imposto: d.imposto,
    lucro: d.lucro,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="h-5 w-5" />
          Seção 4: Histórico Mensal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gráfico de Evolução */}
        {chartData.length > 1 && (
          <div className="h-64">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <AreaChart
                data={chartData}
                margin={{ left: 24, right: 16, top: 8, bottom: 0 }}
              >
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis
                  width={52}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="receita"
                  stackId="1"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.3)"
                />
                <Area
                  type="monotone"
                  dataKey="lucro"
                  stackId="2"
                  stroke="hsl(142, 76%, 36%)"
                  fill="hsl(142, 76%, 36%, 0.3)"
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}

        {/* Tabela Detalhada */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Imposto</TableHead>
                <TableHead className="text-right">Folha</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dadosOrdenados.map((d, index) => {
                const margem = d.receita > 0 ? (d.lucro / d.receita) * 100 : 0;
                const isAtual = d.mes === mesAtual;
                const anterior = index > 0 ? dadosOrdenados[index - 1] : null;
                const crescimento = anterior && anterior.receita > 0
                  ? ((d.receita - anterior.receita) / anterior.receita) * 100
                  : null;

                return (
                  <TableRow key={d.mes} className={isAtual ? 'bg-primary/5' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.mes}</span>
                        {isAtual && <Badge>Atual</Badge>}
                        {crescimento !== null && (
                          <span className={`text-xs flex items-center gap-0.5 ${crescimento >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {crescimento >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(crescimento).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(d.receita)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatCurrency(d.imposto)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(d.folha)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(d.compras)}</TableCell>
                    <TableCell className={`text-right font-medium ${d.lucro >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(d.lucro)}
                    </TableCell>
                    <TableCell className={`text-right ${margem >= 10 ? 'text-green-600' : margem >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {margem.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell>Total / Média</TableCell>
                <TableCell className="text-right">{formatCurrency(totalReceita)}</TableCell>
                <TableCell className="text-right text-destructive">{formatCurrency(totalImposto)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalFolha)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalCompras)}</TableCell>
                <TableCell className="text-right text-green-600">{formatCurrency(totalLucro)}</TableCell>
                <TableCell className="text-right">
                  {totalReceita > 0 ? ((totalLucro / totalReceita) * 100).toFixed(1) : 0}%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
