import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { useDashboardStats, useUltimosRelatorios, useAtividadeRecente } from '@/hooks/useDashboardStats';
import { FileText, Upload, CheckCircle, Users, Clock, AlertTriangle, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  rascunho: { label: 'Rascunho', variant: 'secondary' },
  pendente_aprovacao: { label: 'Pendente', variant: 'outline' },
  aprovado: { label: 'Aprovado', variant: 'default' },
  rejeitado: { label: 'Rejeitado', variant: 'destructive' },
};

const acaoLabels: Record<string, string> = {
  criado: 'criou relatório',
  enviado_aprovacao: 'enviou para aprovação',
  aprovado: 'aprovou',
  rejeitado: 'rejeitou',
  reaberto: 'reabriu',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: ultimosRelatorios, isLoading: relatoriosLoading } = useUltimosRelatorios(5);
  const { data: atividadeRecente, isLoading: atividadeLoading } = useAtividadeRecente(5);

  const firstName = user?.nome?.split(' ')[0] || 'Usuário';

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Olá, {firstName}!
          </h1>
          <p className="text-muted-foreground">
            Bem-vindo ao Sistema de Relatórios ORGAS
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Documentos Processados</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.documentosProcessados || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">Este mês</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pareceres Gerados</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.pareceresGerados || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">Este mês</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pendentes de Aprovação</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.pendentesAprovacao || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">Aguardando revisão</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Alertas Ativos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.alertasAtivos || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">Documentos com erro</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Últimos Pareceres</CardTitle>
              <CardDescription>
                Relatórios fiscais gerados recentemente
              </CardDescription>
            </CardHeader>
            <CardContent>
              {relatoriosLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !ultimosRelatorios || ultimosRelatorios.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p>Nenhum parecer gerado ainda</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ultimosRelatorios.map(relatorio => (
                    <Link
                      key={relatorio.id}
                      to={`/relatorios/${relatorio.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{relatorio.cliente_nome}</p>
                          <p className="text-xs text-muted-foreground">{relatorio.competencia}</p>
                        </div>
                      </div>
                      <Badge variant={statusConfig[relatorio.status]?.variant || 'secondary'}>
                        {statusConfig[relatorio.status]?.label || relatorio.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atividade Recente</CardTitle>
              <CardDescription>
                Últimas ações no sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              {atividadeLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !atividadeRecente || atividadeRecente.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p>Nenhuma atividade recente</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {atividadeRecente.map(atividade => (
                    <div key={atividade.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="h-2 w-2 mt-2 rounded-full bg-primary" />
                      <div className="flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{atividade.usuario_nome}</span>{' '}
                          {acaoLabels[atividade.acao] || atividade.acao}{' '}
                          <span className="text-muted-foreground">{atividade.relatorio_competencia}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {atividade.created_at
                            ? format(new Date(atividade.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })
                            : '-'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Painel Administrativo
              </CardTitle>
              <CardDescription>
                Visão geral do sistema (visível apenas para administradores)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <Link to="/usuarios" className="rounded-lg border border-border p-4 transition-colors hover:bg-muted">
                  <p className="text-sm text-muted-foreground">Gestão de Usuários</p>
                  <p className="text-lg font-bold">Gerenciar Roles →</p>
                </Link>
                <Link to="/fila-aprovacao" className="rounded-lg border border-border p-4 transition-colors hover:bg-muted">
                  <p className="text-sm text-muted-foreground">Fila de Aprovação</p>
                  <p className="text-lg font-bold">{stats?.pendentesAprovacao || 0} Pendentes →</p>
                </Link>
                <Link to="/configuracoes" className="rounded-lg border border-border p-4 transition-colors hover:bg-muted">
                  <p className="text-sm text-muted-foreground">Configurações</p>
                  <p className="text-lg font-bold">Sistema →</p>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
