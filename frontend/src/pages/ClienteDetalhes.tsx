import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Building2, Mail, Phone, MapPin, FileText, Pencil } from 'lucide-react';
import { useCliente, useGrupoEconomico, useUpdateCliente, ClientePJ } from '@/hooks/useClientes';
import { formatCNPJ, maskPhone } from '@/lib/cnpj';
import { useUserRole } from '@/hooks/useUserRole';
import { ClienteForm } from '@/components/clientes/ClienteForm';
import { ClienteDadosExtraidos } from '@/components/clientes/ClienteDadosExtraidos';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ClienteDetalhes() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  
  const { isAdmin, isAnalista } = useUserRole();
  const canEdit = isAdmin || isAnalista;

  const { data: cliente, isLoading, error } = useCliente(id);
  const { data: filiais } = useGrupoEconomico(cliente?.tipo_estabelecimento === 'MATRIZ' ? cliente.id : undefined);
  const updateCliente = useUpdateCliente();

  const handleUpdate = async (data: any) => {
    if (!id) return;
    await updateCliente.mutateAsync({ id, data });
  };

  if (error) {
    return (
      <AppLayout>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-destructive">Erro ao carregar cliente: {error.message}</p>
        </div>
      </AppLayout>
    );
  }

  const getRegimeLabel = (regime: ClientePJ['regime_tributario']) => {
    switch (regime) {
      case 'simples_nacional': return 'Simples Nacional';
      case 'lucro_presumido': return 'Lucro Presumido';
      case 'lucro_real': return 'Lucro Real';
      default: return 'Não informado';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/clientes')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="mt-1 h-4 w-32" />
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground">{cliente?.razao_social}</h1>
                <p className="font-mono text-muted-foreground">{formatCNPJ(cliente?.cnpj || '')}</p>
              </>
            )}
          </div>
          {canEdit && !isLoading && (
            <Button onClick={() => setFormOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Dados da Empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-1/2" />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant={cliente?.tipo_estabelecimento === 'MATRIZ' ? 'default' : 'secondary'}>
                      {cliente?.tipo_estabelecimento}
                    </Badge>
                    <Badge variant={cliente?.ativo ? 'default' : 'destructive'}>
                      {cliente?.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>

                  {cliente?.nome_fantasia && (
                    <div>
                      <p className="text-sm text-muted-foreground">Nome Fantasia</p>
                      <p className="font-medium">{cliente.nome_fantasia}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-sm text-muted-foreground">Regime Tributário</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{getRegimeLabel(cliente?.regime_tributario)}</p>
                      {cliente?.anexo_simples && (
                        <Badge variant="outline">Anexo {cliente.anexo_simples}</Badge>
                      )}
                    </div>
                  </div>

                  {cliente?.cnae_principal && (
                    <div>
                      <p className="text-sm text-muted-foreground">CNAE Principal</p>
                      <p className="font-medium">{cliente.cnae_principal}</p>
                    </div>
                  )}

                  {cliente?.cnae_secundario && (
                    <div>
                      <p className="text-sm text-muted-foreground">CNAE Secundário</p>
                      <p className="font-medium">{cliente.cnae_secundario}</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Contato
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-3/4" />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{cliente?.email || 'Não informado'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{cliente?.telefone ? maskPhone(cliente.telefone) : 'Não informado'}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {cliente?.tipo_estabelecimento === 'MATRIZ' && filiais && filiais.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Grupo Econômico - Filiais
              </CardTitle>
              <CardDescription>
                Empresas vinculadas a esta matriz
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {filiais.map(filial => (
                  <Link
                    key={filial.id}
                    to={`/clientes/${filial.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
                  >
                    <div>
                      <p className="font-medium">{filial.razao_social}</p>
                      <p className="font-mono text-sm text-muted-foreground">{formatCNPJ(filial.cnpj)}</p>
                    </div>
                    <Badge variant="secondary">Filial</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Dados Extraídos */}
        {cliente && <ClienteDadosExtraidos clienteId={cliente.id} />}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Relatórios Fiscais
            </CardTitle>
            <CardDescription>
              Histórico de pareceres fiscais gerados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <p>Acesse a página de Relatórios para gerar pareceres</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {cliente && (
        <ClienteForm
          open={formOpen}
          onOpenChange={setFormOpen}
          cliente={cliente}
          onSubmit={handleUpdate}
          isLoading={updateCliente.isPending}
        />
      )}
    </AppLayout>
  );
}
