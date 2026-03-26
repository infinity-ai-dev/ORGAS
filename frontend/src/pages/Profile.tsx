import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, UserPlus } from 'lucide-react';

export default function Profile() {
  const { user } = useAuth();
  const { isAdmin, isRevisor, isAnalista } = useUserRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  useEffect(() => {
    setFullName(user?.nome || '');
    setAvatarUrl('');
  }, [user]);

  const handleSave = async () => {
    setLoading(true);
    toast({
      title: 'Indisponível no momento',
      description: 'A edição de perfil será habilitada em uma próxima etapa.'
    });
    setLoading(false);
  };

  const getInitials = () => {
    if (fullName) {
      return fullName
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || 'U';
  };

  const getRoleBadges = () => {
    const badges = [];
    if (isAdmin) badges.push(<Badge key="admin" variant="default">Administrador</Badge>);
    if (isRevisor) badges.push(<Badge key="revisor" variant="secondary">Revisor</Badge>);
    if (isAnalista) badges.push(<Badge key="analista" variant="outline">Analista</Badge>);
    if (badges.length === 0) badges.push(<Badge key="none" variant="outline">Sem perfil</Badge>);
    return badges;
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Meu Perfil</h1>
          <p className="text-muted-foreground">Gerencie suas informações pessoais</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Informações da Conta</CardTitle>
            <CardDescription>Dados básicos da sua conta</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={avatarUrl} alt="Avatar" />
                <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{fullName || 'Sem nome'}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <div className="mt-2 flex gap-2">{getRoleBadges()}</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Seu nome completo"
                  disabled
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="avatarUrl">URL do Avatar</Label>
                <Input
                  id="avatarUrl"
                  value={avatarUrl}
                  onChange={e => setAvatarUrl(e.target.value)}
                  placeholder="https://exemplo.com/avatar.jpg"
                  disabled
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  value={user?.email || ''}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  O e-mail não pode ser alterado
                </p>
              </div>
            </div>

            <Button onClick={handleSave} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar alterações
            </Button>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Administração</CardTitle>
              <CardDescription>
                Crie usuários, defina permissões e envie links de acesso por e-mail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/usuarios')}>
                <UserPlus className="mr-2 h-4 w-4" />
                Abrir gestão de usuários
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
