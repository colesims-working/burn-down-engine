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
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState, useRef } from 'react';

const tabs = [
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/clarify', label: 'Clarify', icon: Sparkles },
  { href: '/organize', label: 'Organize', icon: FolderKanban },
  { href: '/engage', label: 'Engage', icon: Zap },
  { href: '/reflect', label: 'Reflect', icon: BarChart3 },
];

const moreItems = [
  { href: '/knowledge', label: 'Knowledge', icon: Brain },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function MobileTopBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click/touch
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [moreOpen]);

  // Close on route change
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    window.location.href = '/login';
  };

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
          <Flame className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Burn-Down</span>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent"
          aria-label="More options"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>

        {moreOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card py-1 shadow-xl">
            {moreItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-sm transition-colors',
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground active:bg-accent',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="mx-3 my-1 border-t border-border" />
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-muted-foreground active:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function MobileBottomTabs() {
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
    const onInboxChanged = () => fetchCount();
    window.addEventListener('inbox-changed', onInboxChanged);
    return () => window.removeEventListener('inbox-changed', onInboxChanged);
  }, [pathname]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const Icon = tab.icon;
          const showBadge = tab.href === '/inbox' && inboxCount > 0;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground active:text-foreground',
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {showBadge && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                )}
              </div>
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
