import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CreditCard, Wallet, ArrowRightLeft, Landmark } from 'lucide-react';
import { formatCurrency } from '@/hooks/useRelatorios';

interface VendasCartao {
  operadora: string;
  valor: number;
}

interface SecaoFinanceiroData {
  vendasCartao: VendasCartao[];
  totalCartao: number;
  pixRecebidos: number;
  qtdPix: number;
  transferenciasRecebidas: number;
  transferenciasMesmaTitularidade: number;
  totalMovimento: number;
  receitaDeclarada: number;
  divergencia: number;
}

interface SecaoFinanceiroProps {
  data: SecaoFinanceiroData;
}

const operadoraColors: Record<string, string> = {
  stone: 'bg-green-500',
  cielo: 'bg-blue-500',
  pagbank: 'bg-yellow-500',
  rede: 'bg-red-500',
  getnet: 'bg-orange-500',
  outros: 'bg-gray-500',
};

export function SecaoFinanceiro({ data }: SecaoFinanceiroProps) {
  const divergenciaPercent = data.divergencia * 100;
  const isDivergente = Math.abs(divergenciaPercent) > 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Landmark className="h-5 w-5" />
          Seção 2: Movimento Financeiro
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cards de Resumo */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Cartões</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(data.totalCartao)}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">PIX</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(data.pixRecebidos)}</p>
            <p className="text-xs text-muted-foreground">{data.qtdPix} operações</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Transferências</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(data.transferenciasRecebidas)}</p>
            <p className="text-xs text-muted-foreground">
              Mesma titularidade: {formatCurrency(data.transferenciasMesmaTitularidade)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-primary/10">
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="h-4 w-4 text-primary" />
              <p className="text-sm text-muted-foreground">Total Movimento</p>
            </div>
            <p className="text-2xl font-bold text-primary">{formatCurrency(data.totalMovimento)}</p>
          </div>
        </div>

        {/* Vendas por Operadora */}
        {data.vendasCartao && data.vendasCartao.length > 0 && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Vendas por Operadora de Cartão
            </h4>
            <div className="space-y-3">
              {data.vendasCartao.map((op, index) => {
                const percentual = data.totalCartao > 0 ? (op.valor / data.totalCartao) * 100 : 0;
                const colorClass = operadoraColors[op.operadora.toLowerCase()] || operadoraColors.outros;
                
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium capitalize">{op.operadora}</span>
                      <span>{formatCurrency(op.valor)} ({percentual.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${colorClass}`}
                        style={{ width: `${percentual}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Análise de Divergência */}
        <div className={`p-4 rounded-lg border ${isDivergente ? 'bg-destructive/10 border-destructive/30' : 'bg-green-500/10 border-green-500/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Comparativo: Faturamento vs Movimento</h4>
            <Badge variant={isDivergente ? 'destructive' : 'default'}>
              {isDivergente ? 'Divergência Crítica' : 'Dentro do Limite'}
            </Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Receita Declarada</p>
              <p className="text-lg font-bold">{formatCurrency(data.receitaDeclarada)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Movimento Real</p>
              <p className="text-lg font-bold">{formatCurrency(data.totalMovimento)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Divergência</p>
              <p className={`text-lg font-bold ${isDivergente ? 'text-destructive' : 'text-green-600'}`}>
                {divergenciaPercent > 0 ? '+' : ''}{divergenciaPercent.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
