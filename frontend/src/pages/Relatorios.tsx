import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RelatoriosList } from '@/components/relatorios/RelatoriosList';
import { RelatorioView } from '@/components/relatorios/RelatorioView';
import { useRelatorio } from '@/hooks/useRelatorios';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';

export default function Relatorios() {
  const { id } = useParams<{ id: string }>();
  const { data: relatorio, isLoading, error } = useRelatorio(id);
  const tipoParecer = String(relatorio?.tipo_parecer || relatorio?.type || '').toLowerCase();
  const tipoParecerLabel = (() => {
    switch (tipoParecer) {
      case 'pessoal':
        return 'Pessoal';
      case 'contabil':
        return 'Contábil';
      case 'atendimento':
        return 'Atendimento';
      case 'fiscal':
      default:
        return 'Fiscal';
    }
  })();
  const relatorioError = error instanceof ApiError ? error : null;
  const errorTitle =
    relatorioError?.status === 403
      ? 'Acesso negado'
      : relatorioError?.status === 404
        ? 'Relatório não encontrado'
        : 'Erro ao carregar relatório';
  const errorDescription =
    relatorioError?.status === 403
      ? 'Você não tem permissão para visualizar este relatório.'
      : relatorioError?.status === 404
        ? 'O relatório solicitado não existe ou não está mais disponível.'
        : 'Não foi possível carregar este relatório no momento.';
  const errorCode =
    relatorioError?.status === 403
      ? '403'
      : relatorioError?.status === 404
        ? '404'
        : '500';

  if (id) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/relatorios">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">
              {relatorio ? `Relatório ${tipoParecerLabel}` : 'Relatório'}
            </h1>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : relatorio ? (
            <RelatorioView relatorio={relatorio} />
          ) : relatorioError ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border bg-muted/40 px-6 py-12">
              <div className="text-center">
                <p className="mb-4 text-5xl font-bold tracking-tight">{errorCode}</p>
                <h2 className="mb-3 text-2xl font-semibold">{errorTitle}</h2>
                <p className="mb-6 max-w-md text-sm text-muted-foreground sm:text-base">
                  {errorDescription}
                </p>
                <Button asChild variant="outline">
                  <Link to="/relatorios">Voltar para Relatórios</Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Relatório não encontrado.</p>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <RelatoriosList />
      </div>
    </AppLayout>
  );
}
