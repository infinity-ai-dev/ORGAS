import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';

interface Alerta {
  tipo: string;
  mensagem: string;
  nivel: 'CRITICO' | 'ALERTA' | 'INFO' | 'OK';
  detalhes?: string;
}

interface AlertasPanelProps {
  alertas: Alerta[];
}

const nivelConfig = {
  CRITICO: {
    icon: AlertCircle,
    variant: 'destructive' as const,
    bgClass: 'bg-destructive/10 border-destructive/30',
    textClass: 'text-destructive',
  },
  ALERTA: {
    icon: AlertTriangle,
    variant: 'secondary' as const,
    bgClass: 'bg-yellow-500/10 border-yellow-500/30',
    textClass: 'text-yellow-600 dark:text-yellow-400',
  },
  INFO: {
    icon: Info,
    variant: 'outline' as const,
    bgClass: 'bg-blue-500/10 border-blue-500/30',
    textClass: 'text-blue-600 dark:text-blue-400',
  },
  OK: {
    icon: CheckCircle,
    variant: 'default' as const,
    bgClass: 'bg-green-500/10 border-green-500/30',
    textClass: 'text-green-600 dark:text-green-400',
  },
};

export function AlertasPanel({ alertas }: AlertasPanelProps) {
  if (!alertas || alertas.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Status do Relatório
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="text-sm text-green-600 dark:text-green-400">
              Nenhum alerta encontrado. Relatório em conformidade.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const alertasCriticos = alertas.filter(a => a.nivel === 'CRITICO');
  const alertasWarning = alertas.filter(a => a.nivel === 'ALERTA');
  const alertasInfo = alertas.filter(a => a.nivel === 'INFO');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" />
            Alertas e Pendências
          </CardTitle>
          <div className="flex gap-2">
            {alertasCriticos.length > 0 && (
              <Badge variant="destructive">{alertasCriticos.length} Críticos</Badge>
            )}
            {alertasWarning.length > 0 && (
              <Badge variant="secondary">{alertasWarning.length} Alertas</Badge>
            )}
            {alertasInfo.length > 0 && (
              <Badge variant="outline">{alertasInfo.length} Info</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alertas.map((alerta, index) => {
            const config = nivelConfig[alerta.nivel] || nivelConfig.INFO;
            const Icon = config.icon;
            
            return (
              <div
                key={index}
                className={`flex items-start gap-3 p-3 rounded-lg border ${config.bgClass}`}
              >
                <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${config.textClass}`} />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={config.variant} className="text-xs">
                      {alerta.tipo}
                    </Badge>
                  </div>
                  <p className={`text-sm font-medium ${config.textClass}`}>
                    {alerta.mensagem}
                  </p>
                  {alerta.detalhes && (
                    <p className="text-xs text-muted-foreground">
                      {alerta.detalhes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
