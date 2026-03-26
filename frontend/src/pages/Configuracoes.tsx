import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/useUserRole';
import { Settings, ShieldOff } from 'lucide-react';

export default function Configuracoes() {
  const { isAdmin, loading: rolesLoading } = useUserRole();

  if (rolesLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Skeleton className="h-8 w-48" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
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
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground">
            Este módulo está temporariamente desabilitado.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldOff className="h-5 w-5" />
              Módulo desativado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              As configurações estão ocultas enquanto ajustamos as opções internas do sistema.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
