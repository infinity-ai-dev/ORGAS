import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  TrendingUp, 
  TrendingDown, 
  FileText, 
  Building2, 
  Calendar,
  Receipt,
  Wallet,
  Users
} from 'lucide-react';
import { RelatorioWithCliente, formatCurrency, formatPercent } from '@/hooks/useRelatorios';

interface RelatorioResumoProps {
  relatorio: RelatorioWithCliente;
}

export function RelatorioResumo({ relatorio }: RelatorioResumoProps) {
  const economia = relatorio.presumido_total - relatorio.simples_valor_devido;
  const economiaPercentual = relatorio.presumido_total > 0 
    ? (economia / relatorio.presumido_total) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Cards Principais */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <p className="text-sm text-muted-foreground">Receita Bruta do Mês</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(relatorio.receita_bruta_mes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">RBT12 (Últimos 12 meses)</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(relatorio.receita_bruta_12_meses)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Notas Emitidas</p>
            </div>
            <p className="text-2xl font-bold">{relatorio.total_notas_emitidas}</p>
            <p className="text-sm text-muted-foreground">{formatCurrency(relatorio.valor_notas_emitidas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Documentos Processados</p>
            </div>
            <p className="text-2xl font-bold">{relatorio.documentos_processados}</p>
          </CardContent>
        </Card>
      </div>

      {/* Comparativo Simples x Lucro Presumido */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Comparativo Tributário Rápido
          </h3>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Simples Nacional */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Simples Nacional</h4>
                <Badge variant="outline">Anexo {relatorio.simples_anexo || relatorio.anexo_efetivo}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Alíquota Efetiva</span>
                <span className="font-medium">{formatPercent(relatorio.simples_aliquota_efetiva)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="font-medium">Total Devido</span>
                <span className="text-xl font-bold text-primary">
                  {formatCurrency(relatorio.simples_valor_devido)}
                </span>
              </div>
            </div>

            {/* Lucro Presumido */}
            <div className="space-y-3">
              <h4 className="font-medium">Lucro Presumido</h4>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Base IRPJ</span>
                <span className="font-medium">{formatCurrency(relatorio.presumido_base_irpj)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="font-medium">Total</span>
                <span className="text-xl font-bold text-muted-foreground">
                  {formatCurrency(relatorio.presumido_total)}
                </span>
              </div>
            </div>
          </div>

          {/* Economia */}
          <div className="mt-6 p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {economia > 0 ? (
                  <TrendingDown className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingUp className="h-5 w-5 text-red-500" />
                )}
                <span className="font-medium">
                  {economia > 0 ? 'Economia com Simples Nacional' : 'Custo adicional no Simples'}
                </span>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold ${economia > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(Math.abs(economia))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatPercent(Math.abs(economiaPercentual))} {economia > 0 ? 'mais barato' : 'mais caro'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cards secundários */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Folha de Pagamento</p>
            </div>
            <p className="text-xl font-bold">{formatCurrency(relatorio.folha_total_bruto)}</p>
            <p className="text-sm text-muted-foreground">
              Encargos: {formatCurrency(relatorio.folha_encargos)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Guias Pagas</p>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Federais:</span>
                <span>{formatCurrency(relatorio.guias_federais)}</span>
              </div>
              <div className="flex justify-between">
                <span>Estaduais:</span>
                <span>{formatCurrency(relatorio.guias_estaduais)}</span>
              </div>
              <div className="flex justify-between">
                <span>Municipais:</span>
                <span>{formatCurrency(relatorio.guias_municipais)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Fator R</p>
            </div>
            {relatorio.fator_r ? (
              <>
                <p className="text-xl font-bold">{formatPercent(relatorio.fator_r)}</p>
                <Badge className={relatorio.fator_r >= 0.28 ? 'bg-green-500' : 'bg-yellow-500'}>
                  {relatorio.fator_r >= 0.28 ? 'Anexo III Elegível' : 'Anexo V'}
                </Badge>
              </>
            ) : (
              <p className="text-muted-foreground">Não aplicável</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
