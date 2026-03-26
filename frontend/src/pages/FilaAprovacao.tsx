import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useRelatoriosEmAprovacao,
  useAprovarRelatorioEmAprovacao,
  useReprovarRelatorioEmAprovacao,
} from '@/hooks/useRelatoriosEmAprovacao';
import { RelatorioEmAprovacaoCard } from '@/components/relatorios/RelatorioEmAprovacaoCard';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { ApprovalDialog } from '@/components/relatorios/ApprovalDialog';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

export default function FilaAprovacao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isRevisor, isAdmin, loading: rolesLoading } = useUserRole();
  const { data: relatorios, isLoading } = useRelatoriosEmAprovacao();
  const aprovar = useAprovarRelatorioEmAprovacao();
  const rejeitar = useReprovarRelatorioEmAprovacao();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState<'aprovar' | 'rejeitar'>('aprovar');

  const pendentes = relatorios || [];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(pendentes.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(i => i !== id));
    }
  };

  const handleBatchAction = (action: 'aprovar' | 'rejeitar') => {
    if (selectedIds.length === 0) return;
    setCurrentAction(action);
    setDialogOpen(true);
  };

  const handleConfirm = async (observacoes: string) => {
    if (!user || selectedIds.length === 0) return;
    const reviewerName = user.nome || user.email || 'Sistema';

    if (currentAction === 'aprovar') {
      for (const id of selectedIds) {
        await aprovar.mutateAsync({ id, aprovadoPor: reviewerName, observacoes });
      }
    } else {
      for (const id of selectedIds) {
        await rejeitar.mutateAsync({
          id,
          reprovadoPor: reviewerName,
          motivo_rejeicao: 'dados_incompletos',
          justificativa: observacoes,
        });
      }
    }

    setSelectedIds([]);
    setDialogOpen(false);
  };

  const handleViewDetails = (id: string) => {
    navigate(`/relatorios-em-aprovacao/${id}`);
  };

  if (rolesLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Skeleton className="h-8 w-48" />
        </div>
      </AppLayout>
    );
  }

  if (!isRevisor && !isAdmin) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Você não tem permissão para acessar esta página.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Fila de Aprovação</h1>
            <p className="text-muted-foreground">
              Relatórios aguardando revisão e aprovação
            </p>
          </div>
          {selectedIds.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleBatchAction('rejeitar')}
                className="text-destructive"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Rejeitar ({selectedIds.length})
              </Button>
              <Button onClick={() => handleBatchAction('aprovar')}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Aprovar ({selectedIds.length})
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pendentes de Aprovação
            </CardTitle>
            <CardDescription>
              {pendentes.length} relatório(s) aguardando sua revisão
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))}
              </div>
            ) : pendentes.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <CheckCircle className="mx-auto mb-2 h-12 w-12 text-green-500" />
                <p>Nenhum relatório pendente de aprovação</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border">
                  <Checkbox
                    checked={selectedIds.length === pendentes.length && pendentes.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-sm font-medium">
                    {selectedIds.length > 0
                      ? `${selectedIds.length} selecionado(s)`
                      : 'Selecionar todos'}
                  </span>
                </div>

                <div className="grid gap-4">
                  {pendentes.map(relatorio => (
                    <div key={relatorio.id} className="relative">
                      <div className="absolute top-4 left-4 z-10">
                        <Checkbox
                          checked={selectedIds.includes(relatorio.id)}
                          onCheckedChange={(checked) => handleSelect(relatorio.id, !!checked)}
                        />
                      </div>
                      <div className="pl-12">
                        <RelatorioEmAprovacaoCard
                          relatorio={relatorio}
                          onViewDetails={handleViewDetails}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ApprovalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={currentAction === 'aprovar' ? 'aprovar' : 'rejeitar'}
        onConfirm={handleConfirm}
        isPending={aprovar.isPending || rejeitar.isPending}
      />
    </AppLayout>
  );
}
