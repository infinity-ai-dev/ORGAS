-- Criar bucket para documentos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos', 
  'documentos', 
  false,
  52428800, -- 50MB limit
  array['application/pdf', 'text/xml', 'application/xml', 'image/png', 'image/jpeg']
);

-- Enum para status do documento
create type public.documento_status as enum ('pendente', 'processando', 'classificado', 'processado', 'erro');

-- Tabela de Documentos
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes_pj(id) on delete cascade not null,
  nome_arquivo text not null,
  nome_original text not null,
  tipo_mime text not null,
  tamanho_bytes bigint not null,
  storage_path text not null,
  periodo text, -- MM/AAAA
  ano integer,
  mes integer,
  status documento_status default 'pendente',
  erro_mensagem text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.documentos enable row level security;

-- Trigger para updated_at
create trigger handle_documentos_updated_at
  before update on public.documentos
  for each row execute function public.handle_updated_at();

-- Indexes
create index idx_documentos_cliente_id on public.documentos(cliente_id);
create index idx_documentos_periodo on public.documentos(ano, mes);
create index idx_documentos_status on public.documentos(status);

-- RLS Policies para documentos

-- Usuarios autenticados podem ver documentos
create policy "Usuarios autenticados podem ver documentos"
  on public.documentos for select
  to authenticated
  using (true);

-- Analistas e Admins podem inserir documentos
create policy "Analistas e Admins podem inserir documentos"
  on public.documentos for insert
  to authenticated
  with check (
    public.has_role(auth.uid(), 'analista') or 
    public.has_role(auth.uid(), 'admin')
  );

-- Analistas e Admins podem atualizar documentos
create policy "Analistas e Admins podem atualizar documentos"
  on public.documentos for update
  to authenticated
  using (
    public.has_role(auth.uid(), 'analista') or 
    public.has_role(auth.uid(), 'admin')
  );

-- Apenas Admins podem deletar documentos
create policy "Admins podem deletar documentos"
  on public.documentos for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Storage Policies para o bucket documentos

-- Usuarios autenticados podem ver arquivos
create policy "Usuarios autenticados podem ver arquivos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documentos');

-- Analistas e Admins podem fazer upload
create policy "Analistas e Admins podem fazer upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documentos' and
    (public.has_role(auth.uid(), 'analista') or public.has_role(auth.uid(), 'admin'))
  );

-- Analistas e Admins podem atualizar arquivos
create policy "Analistas e Admins podem atualizar arquivos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documentos' and
    (public.has_role(auth.uid(), 'analista') or public.has_role(auth.uid(), 'admin'))
  );

-- Admins podem deletar arquivos
create policy "Admins podem deletar arquivos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documentos' and
    public.has_role(auth.uid(), 'admin')
  );