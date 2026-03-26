-- Habilitar extensao pg_trgm para busca fuzzy
create extension if not exists pg_trgm;

-- Enum para regime tributario
create type public.regime_tributario as enum ('simples_nacional', 'lucro_presumido', 'lucro_real');

-- Enum para anexo do simples
create type public.anexo_simples as enum ('I', 'II', 'III', 'IV', 'V');

-- Enum para tipo de estabelecimento
create type public.tipo_estabelecimento as enum ('MATRIZ', 'FILIAL');

-- Tabela de Clientes PJ
create table public.clientes_pj (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null unique,
  razao_social text not null,
  nome_fantasia text,
  regime_tributario regime_tributario,
  anexo_simples anexo_simples,
  cnae_principal text,
  email text,
  telefone text,
  endereco jsonb default '{}'::jsonb,
  grupo_economico_id uuid references public.clientes_pj(id) on delete set null,
  tipo_estabelecimento tipo_estabelecimento default 'MATRIZ',
  ativo boolean default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.clientes_pj enable row level security;

-- Trigger para updated_at
create trigger handle_clientes_pj_updated_at
  before update on public.clientes_pj
  for each row execute function public.handle_updated_at();

-- Index para busca por CNPJ
create index idx_clientes_pj_cnpj on public.clientes_pj(cnpj);

-- Index para busca por razao social com trigram
create index idx_clientes_pj_razao_social on public.clientes_pj using gin(razao_social gin_trgm_ops);

-- RLS Policies para clientes_pj

-- Todos usuarios autenticados podem ver clientes
create policy "Usuarios autenticados podem ver clientes"
  on public.clientes_pj for select
  to authenticated
  using (true);

-- Analistas e Admins podem inserir clientes
create policy "Analistas e Admins podem inserir clientes"
  on public.clientes_pj for insert
  to authenticated
  with check (
    public.has_role(auth.uid(), 'analista') or 
    public.has_role(auth.uid(), 'admin')
  );

-- Analistas e Admins podem atualizar clientes
create policy "Analistas e Admins podem atualizar clientes"
  on public.clientes_pj for update
  to authenticated
  using (
    public.has_role(auth.uid(), 'analista') or 
    public.has_role(auth.uid(), 'admin')
  )
  with check (
    public.has_role(auth.uid(), 'analista') or 
    public.has_role(auth.uid(), 'admin')
  );

-- Apenas Admins podem deletar clientes
create policy "Admins podem deletar clientes"
  on public.clientes_pj for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));