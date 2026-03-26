import { AppLayout } from '@/components/layout/AppLayout';
import { ClientesList } from '@/components/clientes/ClientesList';

export default function Clientes() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Clientes</h1>
          <p className="text-muted-foreground">Gerencie os clientes PJ cadastrados no sistema</p>
        </div>
        <ClientesList />
      </div>
    </AppLayout>
  );
}
