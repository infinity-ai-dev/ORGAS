import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { downloadApiFile, downloadApiFileNative, downloadFile } from '@/lib/download';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { 
  Plus, 
  Loader2, 
  Eye,
  Download,
  RefreshCw,
  Search
} from 'lucide-react';
import { useRelatorios, formatCurrency, RelatorioStatus, RelatorioWithCliente } from '@/hooks/useRelatorios';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const statusConfig: Record<RelatorioStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  rascunho: { label: 'Rascunho', variant: 'outline' },
  pendente_aprovacao: { label: 'Pendente', variant: 'secondary' },
  aprovado: { label: 'Aprovado', variant: 'default' },
  rejeitado: { label: 'Rejeitado', variant: 'destructive' },
};

const ITEMS_PER_PAGE = 20;

interface RelatoriosListProps {
  clienteIdFilter?: string;
}

export function RelatoriosList({ clienteIdFilter }: RelatoriosListProps) {
  const queryClient = useQueryClient();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [clienteSearch, setClienteSearch] = useState('');
  const [analistaSearch, setAnalistaSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const { data: relatorios, isLoading, refetch, isFetching } = useRelatorios(clienteIdFilter);

  // Filtered data
  const filteredRelatorios = useMemo(() => {
    if (!relatorios) return [];

    return relatorios.filter((rel: RelatorioWithCliente) => {
      // Status filter
      if (statusFilter !== 'todos' && rel.status !== statusFilter) {
        return false;
      }

      // Cliente search
      if (clienteSearch) {
        const searchLower = clienteSearch.toLowerCase();
        const matchesCliente = 
          rel.clientes_pj.razao_social.toLowerCase().includes(searchLower) ||
          rel.clientes_pj.cnpj.includes(clienteSearch);
        if (!matchesCliente) return false;
      }

      // Analista search (TODO: quando tivermos campo de analista)
      // Por enquanto, não filtra por analista

      return true;
    });
  }, [relatorios, statusFilter, clienteSearch]);

  // Pagination
  const totalPages = Math.ceil(filteredRelatorios.length / ITEMS_PER_PAGE);
  const paginatedRelatorios = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRelatorios.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRelatorios, currentPage]);

  const handleRefresh = () => {
    refetch();
  };

  // Reset page when filters change
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleClienteSearchChange = (value: string) => {
    setClienteSearch(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild>
          <Link to="/gerador">
            <Plus className="mr-2 h-4 w-4" />
            Gerar Relatório
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente ou CNPJ..."
            className="pl-10"
            value={clienteSearch}
            onChange={e => handleClienteSearchChange(e.target.value)}
          />
        </div>

        <Tabs value={statusFilter} onValueChange={handleStatusChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="pendente_aprovacao">Pendentes</TabsTrigger>
            <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
            <TabsTrigger value="rejeitado">Rejeitados</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Receita Bruta</TableHead>
              <TableHead className="text-right">Imposto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                </TableCell>
              </TableRow>
            ) : paginatedRelatorios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Nenhum relatório encontrado
                </TableCell>
              </TableRow>
            ) : (
              paginatedRelatorios.map((rel: RelatorioWithCliente) => (
                <TableRow key={rel.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="font-medium truncate max-w-[180px] sm:max-w-none">
                        {rel.clientes_pj.razao_social}
                      </p>
                      <p className="text-sm text-muted-foreground truncate max-w-[180px] sm:max-w-none">
                        {rel.clientes_pj.cnpj}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{rel.competencia || '-'}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rel.receita_bruta_mes)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rel.simples_valor_devido)}</TableCell>
                  <TableCell>
                    <Badge variant={statusConfig[rel.status].variant}>
                      {statusConfig[rel.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {rel.arquivo_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            try {
                              await downloadApiFileNative(`/relatorios/${rel.id}/pdf`);
                            } catch (error) {
                              try {
                                await downloadApiFile(`/relatorios/${rel.id}/pdf?download=1`, rel.arquivo_nome || undefined);
                              } catch (directDownloadError) {
                                const url = rel.arquivo_url as string;
                                try {
                                  await downloadFile(url, rel.arquivo_nome || undefined);
                                } catch (fallbackError) {
                                  console.warn('Falha ao baixar PDF, abrindo em nova guia:', fallbackError);
                                  window.open(url, '_blank');
                                }
                              }
                            }
                          }}
                          aria-label="Baixar PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="icon">
                        <Link to={`/relatorios/${rel.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              />
            </PaginationItem>

            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              const page = i + 1;
              return (
                <PaginationItem key={page}>
                  <PaginationLink
                    isActive={page === currentPage}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              );
            })}

            {totalPages > 5 && <PaginationEllipsis />}

            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
