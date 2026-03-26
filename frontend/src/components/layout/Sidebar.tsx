import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';
import { Logo } from '@/components/Logo';
import {
  LayoutDashboard,
  FileText,
  CheckCircle,
  Users,
  Building2,
  User,
  Wand2
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: ('analista' | 'revisor' | 'admin')[];
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Meu Perfil', href: '/profile', icon: User },
  { title: 'Clientes', href: '/clientes', icon: Building2 },
  { title: 'Gerador', href: '/gerador', icon: Wand2, roles: ['analista', 'admin'] },
  { title: 'Relatórios', href: '/relatorios', icon: FileText },
  { title: 'Fila de Aprovação', href: '/fila-aprovacao', icon: CheckCircle, roles: ['revisor', 'admin'] },
  { title: 'Gestão de Usuários', href: '/usuarios', icon: Users, roles: ['admin'] },
  // Configurações temporariamente desabilitado
];

export function Sidebar() {
  const location = useLocation();
  const { isAnalista, isRevisor, isAdmin, roles } = useUserRole();

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.some(role => roles.includes(role));
  });

  return (
    <aside className="hidden w-64 flex-shrink-0 border-r border-sidebar-border bg-sidebar-background md:block">
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <Logo size={32} className="rounded-sm text-sidebar-primary dark:text-sidebar-foreground" />
        <span className="ml-2 text-lg font-semibold text-sidebar-foreground">ORGAS</span>
      </div>
      <nav className="flex flex-col gap-1 p-4">
        {filteredNavItems.map(item => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-300',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
