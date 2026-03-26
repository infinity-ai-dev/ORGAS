import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCircle,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import {
  useAddRole,
  useCreateUsuario,
  useRemoveRole,
  useSendMagicLink,
  useSendResetLink,
  useSetUsuarioPassword,
  useUsuarios,
  type UserWithRoles,
} from '@/hooks/useUsuarios';

const roleConfig: Record<AppRole, { label: string; icon: React.ReactNode; variant: 'default' | 'secondary' | 'outline' }> = {
  admin: { label: 'Administrador', icon: <Shield className="h-3 w-3" />, variant: 'default' },
  revisor: { label: 'Revisor', icon: <CheckCircle className="h-3 w-3" />, variant: 'secondary' },
  analista: { label: 'Analista', icon: <FileText className="h-3 w-3" />, variant: 'outline' }
};

function normalizeUserRole(user: UserWithRoles): AppRole | '' {
  const role = user.roles[0];
  return role === 'admin' || role === 'revisor' || role === 'analista' ? role : '';
}

export default function Usuarios() {
  const { isAdmin, loading: rolesLoading } = useUserRole();
  const { data: usuarios, isLoading } = useUsuarios();
  const addRole = useAddRole();
  const removeRole = useRemoveRole();
  const createUsuario = useCreateUsuario();
  const sendMagicLink = useSendMagicLink();
  const sendResetLink = useSendResetLink();
  const setUsuarioPassword = useSetUsuarioPassword();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('analista');
  const [password, setPassword] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [sendReset, setSendReset] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRoles | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const loadingAction = useMemo(
    () =>
      createUsuario.isPending ||
      addRole.isPending ||
      removeRole.isPending ||
      sendMagicLink.isPending ||
      sendResetLink.isPending ||
      setUsuarioPassword.isPending,
    [
      addRole.isPending,
      createUsuario.isPending,
      removeRole.isPending,
      sendMagicLink.isPending,
      sendResetLink.isPending,
      setUsuarioPassword.isPending,
    ]
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const resetCreateForm = () => {
    setNome('');
    setEmail('');
    setRole('analista');
    setPassword('');
    setSendInvite(true);
    setSendReset(false);
  };

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await createUsuario.mutateAsync({
      nome,
      email,
      role,
      password: password || undefined,
      sendMagicLink: sendInvite,
      sendResetLink: !sendInvite && sendReset,
    });
    resetCreateForm();
  };

  const handleAddRole = (userId: string, nextRole: AppRole) => {
    addRole.mutate({ userId, role: nextRole });
  };

  const handleRemoveRole = (userId: string, nextRole: AppRole) => {
    removeRole.mutate({ userId, role: nextRole });
  };

  const openPasswordDialog = (usuario: UserWithRoles) => {
    setSelectedUser(usuario);
    setNewPassword('');
    setPasswordDialogOpen(true);
  };

  const submitPasswordDialog = async () => {
    if (!selectedUser) {
      return;
    }
    await setUsuarioPassword.mutateAsync({
      userId: selectedUser.id,
      newPassword,
    });
    setPasswordDialogOpen(false);
    setSelectedUser(null);
    setNewPassword('');
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
          <h1 className="text-2xl font-bold text-foreground">Gestão de Usuários</h1>
          <p className="text-muted-foreground">
            Crie usuários, gerencie permissões e acione autenticação por e-mail.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Criar novo usuário
            </CardTitle>
            <CardDescription>
              O convite pode ser enviado por magic link assinado, sem exigir senha inicial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateUser}>
              <div className="space-y-2">
                <Label htmlFor="usuario-nome">Nome completo</Label>
                <Input
                  id="usuario-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome do usuário"
                  required
                  disabled={loadingAction}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usuario-email">E-mail</Label>
                <Input
                  id="usuario-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  required
                  disabled={loadingAction}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usuario-role">Perfil</Label>
                <Select value={role} onValueChange={(value) => setRole(value as AppRole)} disabled={loadingAction}>
                  <SelectTrigger id="usuario-role">
                    <SelectValue placeholder="Selecione o perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analista">Analista</SelectItem>
                    <SelectItem value="revisor">Revisor</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="usuario-password">Senha inicial opcional</Label>
                <Input
                  id="usuario-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Deixe em branco para usar só e-mail"
                  disabled={loadingAction}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Enviar magic link</p>
                  <p className="text-xs text-muted-foreground">
                    O usuário entra com um link assinado enviado por e-mail.
                  </p>
                </div>
                <Switch
                  checked={sendInvite}
                  onCheckedChange={(checked) => {
                    setSendInvite(checked);
                    if (checked) {
                      setSendReset(false);
                    }
                  }}
                  disabled={loadingAction}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Enviar link de redefinição</p>
                  <p className="text-xs text-muted-foreground">
                    Útil quando você não quer definir uma senha manual agora.
                  </p>
                </div>
                <Switch
                  checked={sendReset}
                  onCheckedChange={(checked) => {
                    setSendReset(checked);
                    if (checked) {
                      setSendInvite(false);
                    }
                  }}
                  disabled={loadingAction}
                />
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <Button type="submit" disabled={loadingAction}>
                  {createUsuario.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Criar usuário
                </Button>
                <Button type="button" variant="ghost" onClick={resetCreateForm} disabled={loadingAction}>
                  Limpar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Usuários do Sistema
            </CardTitle>
            <CardDescription>
              {usuarios?.length || 0} usuário(s) cadastrado(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : usuarios?.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="mx-auto mb-2 h-12 w-12" />
                <p>Nenhum usuário cadastrado</p>
              </div>
            ) : (
              <div className="space-y-3">
                {usuarios?.map(usuario => (
                  <div
                    key={usuario.id}
                    className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={usuario.avatar_url || undefined} />
                        <AvatarFallback>{getInitials(usuario.full_name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{usuario.full_name}</p>
                        <p className="text-sm text-muted-foreground">{usuario.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Desde {usuario.created_at
                            ? format(new Date(usuario.created_at), 'dd/MM/yyyy', { locale: ptBR })
                            : '-'}
                        </p>
                      </div>
                    </div>

                    <div className="flex-1 flex flex-wrap gap-1">
                      {usuario.roles.length === 0 ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Sem roles
                        </Badge>
                      ) : (
                        usuario.roles.map(userRole => (
                          <Badge
                            key={userRole}
                            variant={roleConfig[userRole].variant}
                            className="flex items-center gap-1"
                          >
                            {roleConfig[userRole].icon}
                            {roleConfig[userRole].label}
                          </Badge>
                        ))
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendMagicLink.mutate({ userId: usuario.id })}
                        disabled={loadingAction}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Magic link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openPasswordDialog(usuario)}
                        disabled={loadingAction}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        Senha
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={loadingAction}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Ações do usuário</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => sendResetLink.mutate({ userId: usuario.id })}>
                            <Mail className="mr-2 h-4 w-4" />
                            Enviar link de redefinição
                          </DropdownMenuItem>
                          {(['analista', 'revisor', 'admin'] as AppRole[]).map(nextRole => {
                            const hasRole = normalizeUserRole(usuario) === nextRole;
                            return (
                              <DropdownMenuItem
                                key={nextRole}
                                onClick={() => hasRole
                                  ? handleRemoveRole(usuario.id, nextRole)
                                  : handleAddRole(usuario.id, nextRole)
                                }
                              >
                                {hasRole ? (
                                  <>
                                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                                    Remover {roleConfig[nextRole].label}
                                  </>
                                ) : (
                                  <>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Definir como {roleConfig[nextRole].label}
                                  </>
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sobre as Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Analista</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Pode fazer upload de documentos, cadastrar clientes e gerar relatórios.
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Revisor</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Pode aprovar ou rejeitar relatórios pendentes de aprovação.
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Administrador</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Acesso completo, incluindo criação de usuários e autenticação por e-mail.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Definir senha do usuário</DialogTitle>
              <DialogDescription>
                {selectedUser
                  ? `Defina uma senha manual para ${selectedUser.full_name}.`
                  : 'Defina uma senha manual para o usuário.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="nova-senha-usuario">Nova senha</Label>
              <Input
                id="nova-senha-usuario"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                disabled={setUsuarioPassword.isPending}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPasswordDialogOpen(false)} disabled={setUsuarioPassword.isPending}>
                Cancelar
              </Button>
              <Button onClick={submitPasswordDialog} disabled={setUsuarioPassword.isPending || newPassword.length < 8}>
                {setUsuarioPassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar senha
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
