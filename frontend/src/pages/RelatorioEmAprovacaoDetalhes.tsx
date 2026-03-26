import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  useRelatorioEmAprovacaoDetalhes,
  useAprovarRelatorioEmAprovacao,
  useReprovarRelatorioEmAprovacao,
  isPareceiFiscal,
  isParecerPersonal,
} from '@/hooks/useRelatoriosEmAprovacao';
import { ApprovalDialog } from '@/components/relatorios/ApprovalDialog';
import { AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function RelatorioEmAprovacaoDetalhes() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: relatorio, isLoading } = useRelatorioEmAprovacaoDetalhes(id);
  const aprovar = useAprovarRelatorioEmAprovacao();
  const rejeitar = useReprovarRelatorioEmAprovacao();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState<'aprovar' | 'rejeitar'>('aprovar');

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!relatorio) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="mx-auto mb-2 h-12 w-12 text-red-500" />
            <p className="text-muted-foreground">Relatório não encontrado</p>
            <Button
              variant="outline"
              onClick={() => navigate('/fila-aprovacao')}
              className="mt-4"
            >
              Voltar para fila de aprovação
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const responseData = relatorio.response_data;
  const isFiscal = isPareceiFiscal(responseData);

  const handleApprove = async (observacoes: string) => {
    if (!id || !user) return;
    await aprovar.mutateAsync({
      id,
      aprovadoPor: user.nome || user.email || 'Sistema',
      observacoes,
    });
    setDialogOpen(false);
    navigate('/fila-aprovacao');
  };

  const handleReject = async (observacoes: string) => {
    if (!id || !user) return;
    await rejeitar.mutateAsync({
      id,
      reprovadoPor: user.nome || user.email || 'Sistema',
      motivo_rejeicao: 'dados_incompletos',
      justificativa: observacoes,
    });
    setDialogOpen(false);
    navigate('/fila-aprovacao');
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/fila-aprovacao')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{relatorio.cliente_nome}</h1>
              <p className="text-muted-foreground">
                {relatorio.tipo_parecer.charAt(0).toUpperCase() +
                  relatorio.tipo_parecer.slice(1)}
              </p>
            </div>
          </div>
          <Badge variant={responseData.is_valid ? 'default' : 'secondary'}>
            {responseData.is_valid ? 'Válido' : 'Com erros'}
          </Badge>
        </div>

        {/* Dados do parecer fiscal */}
        {isFiscal && responseData.receita_bruta && (
          <Card>
            <CardHeader>
              <CardTitle>Análise Fiscal</CardTitle>
              <CardDescription>
                Dados apurados pelo agente fiscal
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">
                    Regime Tributário
                  </div>
                  <div className="text-lg font-bold">
                    {responseData.regime_tributario || 'N/A'}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">
                    Receita Bruta
                  </div>
                  <div className="text-2xl font-bold">
                    {typeof responseData.receita_bruta === 'object'
                      ? responseData.receita_bruta.formatado || 'R$ 0,00'
                      : `R$ ${(responseData.receita_bruta || 0).toLocaleString('pt-BR')}`}
                  </div>
                </div>
                {responseData.despesas && (
                  <div className="rounded-lg bg-muted p-4">
                    <div className="text-sm text-muted-foreground">
                      Despesas
                    </div>
                    <div className="text-2xl font-bold">
                      {typeof responseData.despesas === 'object'
                        ? `R$ ${(responseData.despesas.total || 0).toLocaleString('pt-BR')}`
                        : `R$ ${(responseData.despesas || 0).toLocaleString('pt-BR')}`}
                    </div>
                  </div>
                )}
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">
                    Imposto Devido
                  </div>
                  <div className="text-2xl font-bold">
                    {typeof responseData.impostos === 'object'
                      ? `R$ ${(responseData.impostos.devido || 0).toLocaleString('pt-BR')}`
                      : 'R$ 0,00'}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">
                    Imposto Pago
                  </div>
                  <div className="text-2xl font-bold">
                    {typeof responseData.impostos === 'object'
                      ? `R$ ${(responseData.impostos.pago || 0).toLocaleString('pt-BR')}`
                      : 'R$ 0,00'}
                  </div>
                </div>
              </div>

              {typeof responseData.impostos === 'object' && responseData.impostos.diferenca !== 0 && (
                <div
                  className={`rounded-lg p-4 ${
                    responseData.impostos.diferenca > 0
                      ? 'bg-red-50 dark:bg-red-950'
                      : 'bg-green-50 dark:bg-green-950'
                  }`}
                >
                  <div className="text-sm font-medium mb-1">
                    Diferença (Imposto Devido - Pago)
                  </div>
                  <div
                    className={`text-3xl font-bold ${
                      responseData.impostos.diferenca > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-green-600 dark:text-green-400'
                    }`}
                  >
                    R$ {(responseData.impostos.diferenca || 0).toLocaleString('pt-BR')}
                  </div>
                </div>
              )}

              {responseData.obrigacoes_acessorias && (
                <div className="space-y-2">
                  <div className="font-medium">Obrigações Acessórias</div>
                  <div className="flex flex-wrap gap-2">
                    {responseData.obrigacoes_acessorias.map(
                      (obrigacao: string) => (
                        <Badge key={obrigacao} variant="outline">
                          {obrigacao}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}


        {/* Dados Anonimizados (Parecer Pessoal) */}
        {isParecerPersonal(responseData) && responseData.personal_data_anonymized && (
          <Card>
            <CardHeader>
              <CardTitle>Dados Anonimizados</CardTitle>
              <CardDescription>
                Informações pessoais após aplicação de técnicas de anonimização
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Nome Completo</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.nome_completo}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Profissão</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.profissao}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Data de Nascimento</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.data_nascimento}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Estado Civil</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.estado_civil}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Dependentes</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.dependentes}
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <div className="text-sm text-muted-foreground">Renda Aproximada</div>
                  <div className="text-lg font-bold">
                    {responseData.personal_data_anonymized.renda_aproximada}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Dados Mascarados:</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>📧 Email: {responseData.personal_data_anonymized.email}</div>
                  <div>📱 Telefone: {responseData.personal_data_anonymized.telefone}</div>
                  <div>🏠 Endereço: {responseData.personal_data_anonymized.endereco}</div>
                  <div>🔑 CPF: {responseData.personal_data_anonymized.cpf}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Regras de Anonimização */}
        {isParecerPersonal(responseData) &&
          (responseData as any).masking_rules_applied?.length > 0 && (
            <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
              <CardHeader>
                <CardTitle className="text-blue-600 dark:text-blue-400">
                  Técnicas de Anonimização Aplicadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {(responseData as any).masking_rules_applied.map(
                    (rule: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="text-blue-600 dark:text-blue-400">✓</span>
                        <span>{rule}</span>
                      </li>
                    )
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

        {/* Conformidade (Parecer Pessoal) */}
        {isParecerPersonal(responseData) && responseData.compliance && (
          <Card>
            <CardHeader>
              <CardTitle>Status de Conformidade</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Badge variant={responseData.compliance.gdpr ? 'default' : 'secondary'}>
                    {responseData.compliance.gdpr ? '✓' : '✗'}
                  </Badge>
                  <span className="font-medium">GDPR</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={responseData.compliance.lgpd ? 'default' : 'secondary'}>
                    {responseData.compliance.lgpd ? '✓' : '✗'}
                  </Badge>
                  <span className="font-medium">LGPD</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={responseData.compliance.data_minimization ? 'default' : 'secondary'}>
                    {responseData.compliance.data_minimization ? '✓' : '✗'}
                  </Badge>
                  <span className="font-medium">Minimização de Dados</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default">
                    {responseData.compliance.anonymization_level}
                  </Badge>
                  <span className="font-medium">Nível de Anonimização</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Resumo Pessoal */}
        {isParecerPersonal(responseData) && responseData.personal_summary && (
          <Card>
            <CardHeader>
              <CardTitle>Análise de Perfil de Risco e Recomendações</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {responseData.personal_summary}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Erros de Validação */}
        {!responseData.is_valid &&
          (responseData as any).validation_errors?.length > 0 && (
            <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="h-5 w-5" />
                  Erros de Validação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {(responseData as any).validation_errors.map(
                    (error: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="text-red-600 dark:text-red-400">•</span>
                        <span>{error}</span>
                      </li>
                    )
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

        {/* Recomendações */}
        {(responseData as any).recommendations?.length > 0 && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <CheckCircle2 className="h-5 w-5" />
                Recomendações
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(responseData as any).recommendations.map(
                  (rec: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-blue-600 dark:text-blue-400">•</span>
                      <span>{rec}</span>
                    </li>
                  )
                )}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Riscos Identificados */}
        {(responseData as any).risks_identified?.length > 0 && (
          <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="h-5 w-5" />
                Riscos Identificados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(responseData as any).risks_identified.map(
                  (risk: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-yellow-600 dark:text-yellow-400">•</span>
                      <span>{risk}</span>
                    </li>
                  )
                )}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Botões de Ação */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setCurrentAction('aprovar');
                  setDialogOpen(true);
                }}
                className="flex-1"
                disabled={aprovar.isPending || rejeitar.isPending}
              >
                Aprovar Relatório
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setCurrentAction('rejeitar');
                  setDialogOpen(true);
                }}
                className="flex-1"
                disabled={aprovar.isPending || rejeitar.isPending}
              >
                Rejeitar Relatório
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/fila-aprovacao')}
                disabled={aprovar.isPending || rejeitar.isPending}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <ApprovalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={currentAction}
        onConfirm={
          currentAction === 'aprovar'
            ? handleApprove
            : handleReject
        }
        isPending={aprovar.isPending || rejeitar.isPending}
      />
    </AppLayout>
  );
}
