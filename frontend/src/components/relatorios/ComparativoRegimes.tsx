import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Scale, TrendingDown, TrendingUp, CheckCircle } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/hooks/useRelatorios';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts';

interface RegimeData {
  nome: string;
  aliquota: number;
  valorDevido: number;
  detalhes: {
    tributo: string;
    valor: number;
  }[];
}

interface ComparativoRegimesProps {
  simplesAnexoIII: RegimeData;
  simplesAnexoV: RegimeData;
  lucroPresumido: RegimeData;
  regimeRecomendado: string;
  fatorR: number | null;
  economiaTotal: number;
}

const chartConfig = {
  valor: { label: 'Valor', color: 'hsl(var(--primary))' },
};

export function ComparativoRegimes({
  simplesAnexoIII,
  simplesAnexoV,
  lucroPresumido,
  regimeRecomendado,
  fatorR,
  economiaTotal,
}: ComparativoRegimesProps) {
  const regimes = [simplesAnexoIII, simplesAnexoV, lucroPresumido];
  const menorValor = Math.min(...regimes.map(r => r.valorDevido));
  
  const chartData = regimes.map(r => ({
    name: r.nome,
    valor: r.valorDevido,
    isRecomendado: r.valorDevido === menorValor,
  }));

  const getBarColor = (isRecomendado: boolean) => 
    isRecomendado ? 'hsl(142, 76%, 36%)' : 'hsl(var(--muted-foreground))';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scale className="h-5 w-5" />
          Seção 7: Análise Tributária Comparativa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fator R */}
        {fatorR !== null && (
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Fator R (Folha / RBT12)</h4>
                <p className="text-2xl font-bold mt-1">{formatPercent(fatorR)}</p>
              </div>
              <div className="text-right">
                {fatorR >= 0.28 ? (
                  <>
                    <Badge className="bg-green-500 mb-1">Elegível Anexo III</Badge>
                    <p className="text-sm text-muted-foreground">
                      Fator R ≥ 28% permite tributação no Anexo III
                    </p>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary" className="mb-1">Anexo V Obrigatório</Badge>
                    <p className="text-sm text-muted-foreground">
                      Fator R &lt; 28%, permanece no Anexo V
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Gráfico Comparativo */}
        <div className="h-48">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <BarChart data={chartData} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="valor" radius={4}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.isRecomendado)} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>

        {/* Cards de Comparação */}
        <div className="grid gap-4 md:grid-cols-3">
          {regimes.map((regime, index) => {
            const isRecomendado = regime.valorDevido === menorValor;
            const diferenca = regime.valorDevido - menorValor;
            
            return (
              <div
                key={index}
                className={`p-4 rounded-lg border ${
                  isRecomendado 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : 'bg-muted/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">{regime.nome}</h4>
                  {isRecomendado && (
                    <Badge className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Recomendado
                    </Badge>
                  )}
                </div>
                
                <p className="text-sm text-muted-foreground">Alíquota Efetiva</p>
                <p className="text-lg font-medium mb-2">{formatPercent(regime.aliquota)}</p>
                
                <Separator className="my-2" />
                
                <p className="text-sm text-muted-foreground">Total Devido</p>
                <p className={`text-2xl font-bold ${isRecomendado ? 'text-green-600' : ''}`}>
                  {formatCurrency(regime.valorDevido)}
                </p>
                
                {!isRecomendado && diferenca > 0 && (
                  <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    +{formatCurrency(diferenca)} vs melhor opção
                  </p>
                )}

                {/* Detalhamento */}
                <div className="mt-3 pt-3 border-t space-y-1">
                  {regime.detalhes.slice(0, 5).map((det, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{det.tributo}</span>
                      <span>{formatCurrency(det.valor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumo da Economia */}
        <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-green-500" />
              <span className="font-medium">
                Economia optando por {regimeRecomendado}
              </span>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(economiaTotal)}
              </p>
              <p className="text-sm text-muted-foreground">
                vs pior opção tributária
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
