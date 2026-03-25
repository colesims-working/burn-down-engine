'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Inbox,
  Sparkles,
  FolderKanban,
  Zap,
  BarChart3,
  Brain,
  Settings,
  Flame,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  description: string;
}

const navItems: NavItem[] = [
  { href: '/inbox', label: 'Inbox', icon: Inbox, description: 'Capture' },
  { href: '/clarify', label: 'Clarify', icon: Sparkles, description: 'Process' },
  { href: '/organize', label: 'Organize', icon: FolderKanban, description: 'Structure' },
  { href: '/engage', label: 'Engage', icon: Zap, description: 'Execute' },
  { href: '/reflect', label: 'Reflect', icon: BarChart3, description: 'Learn' },
];

const bottomItems: NavItem[] = [
  { href: '/knowledge', label: 'Knowledge', icon: Brain, description: 'Memory' },
  { href: '/settings', label: 'Settings', icon: Settings, description: 'Config' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    async function fetchCount() {
      try {
        const res = await fetch('/api/todoist?action=inbox-count');
        if (res.ok) {
          const data = await res.json();
          setInboxCount(data.count || 0);
        }
      } catch {}
    }
    fetchCount();
  }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    window.location.href = '/login';
  };

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
          <Flame className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Burn-Down
          </h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Engine
          </p>
        </div>
      </div>

      {/* Workflow arrow indicator */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 rounded-md bg-secondary/50 px-2.5 py-1.5">
          {navItems.map((item, i) => {
            const isActive = pathname === item.href;
            const isPast = navItems.findIndex(n => n.href === pathname) > i;
            return (
              <div key={item.href} className="flex items-center">
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    isActive && 'bg-primary',
                    isPast && 'bg-primary/40',
                    !isActive && !isPast && 'bg-muted-foreground/30',
                  )}
                />
                {i < navItems.length - 1 && (
                  <div
                    className={cn(
                      'mx-0.5 h-px w-3',
                      isPast ? 'bg-primary/30' : 'bg-muted-foreground/20',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          const showBadge = item.href === '/inbox' && inboxCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
              <span className="flex-1 truncate font-medium">{item.label}</span>
              {showBadge && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/20 px-1.5 text-xs font-semibold text-primary">
                  {inboxCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom nav */}
      <div className="space-y-0.5 border-t border-border px-3 py-3">
        {bottomItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate font-medium">{item.label}</span>
            </Link>
          );
        })}

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="font-medium">Log out</span>
        </button>
      </div>
    </aside>
  );
}
