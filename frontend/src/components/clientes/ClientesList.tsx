import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, Plus, MoreHorizontal, Pencil, Trash2, Eye, Building2, Loader2 } from 'lucide-react';
import { ClientePJ, useClientes, useDeleteCliente, useCreateCliente, useUpdateCliente } from '@/hooks/useClientes';
import { formatCNPJ } from '@/lib/cnpj';
import { useUserRole } from '@/hooks/useUserRole';
import { ClienteForm } from './ClienteForm';
import { useDebounce } from '@/hooks/useDebounce';

export function ClientesList() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<ClientePJ | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { isAdmin, isAnalista } = useUserRole();
  const canEdit = isAdmin || isAnalista;
  const canDelete = isAdmin;

  const { data: clientes, isLoading, error } = useClientes(debouncedSearch);
  const createCliente = useCreateCliente();
  const updateCliente = useUpdateCliente();
  const deleteCliente = useDeleteCliente();

  const handleCreate = async (data: any) => {
    await createCliente.mutateAsync(data);
  };

  const handleUpdate = async (data: any) => {
    if (!editingCliente) return;
    await updateCliente.mutateAsync({ id: editingCliente.id, data });
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteCliente.mutateAsync(deletingId);
    setDeletingId(null);
  };

  const getRegimeBadge = (regime: ClientePJ['regime_tributario']) => {
    switch (regime) {
      case 'simples_nacional':
        return <Badge variant="default">Simples Nacional</Badge>;
      case 'lucro_presumido':
        return <Badge variant="secondary">Lucro Presumido</Badge>;
      case 'lucro_real':
        return <Badge variant="outline">Lucro Real</Badge>;
      default:
        return <Badge variant="outline">Não informado</Badge>;
    }
  };

  const getTipoBadge = (tipo: ClientePJ['tipo_estabelecimento']) => {
    return tipo === 'MATRIZ' 
      ? <Badge variant="default" className="bg-primary">Matriz</Badge>
      : <Badge variant="secondary">Filial</Badge>;
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
        <p className="text-destructive">Erro ao carregar clientes: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por CNPJ ou razão social..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        {canEdit && (
          <Button onClick={() => { setEditingCliente(null); setFormOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Cliente
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CNPJ</TableHead>
              <TableHead>Razão Social</TableHead>
              <TableHead className="hidden md:table-cell">Regime</TableHead>
              <TableHead className="hidden sm:table-cell">Tipo</TableHead>
              <TableHead className="hidden lg:table-cell">E-mail</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : clientes?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {searchTerm ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
                </TableCell>
              </TableRow>
            ) : (
              clientes?.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-mono text-sm">{formatCNPJ(cliente.cnpj)}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="font-medium truncate max-w-[220px] sm:max-w-none">
                        {cliente.razao_social}
                      </p>
                      {cliente.nome_fantasia && (
                        <p className="text-sm text-muted-foreground truncate max-w-[220px] sm:max-w-none">
                          {cliente.nome_fantasia}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-1">
                      {getRegimeBadge(cliente.regime_tributario)}
                      {cliente.anexo_simples && (
                        <Badge variant="outline">Anexo {cliente.anexo_simples}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {getTipoBadge(cliente.tipo_estabelecimento)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {cliente.email || '-'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/clientes/${cliente.id}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            Ver detalhes
                          </Link>
                        </DropdownMenuItem>
                        {canEdit && (
                          <DropdownMenuItem onClick={() => { setEditingCliente(cliente); setFormOpen(true); }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem 
                            onClick={() => setDeletingId(cliente.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ClienteForm
        open={formOpen}
        onOpenChange={setFormOpen}
        cliente={editingCliente}
        onSubmit={editingCliente ? handleUpdate : handleCreate}
        isLoading={createCliente.isPending || updateCliente.isPending}
      />

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O cliente e todos os dados relacionados serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteCliente.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
