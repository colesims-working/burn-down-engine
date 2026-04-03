import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Sidebar } from '@/components/nav/sidebar';
import { MobileTopBar, MobileBottomTabs } from '@/components/nav/mobile-nav';
import { isAuthenticated } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Burn-Down Engine',
  description: 'A daily-driven GTD intelligence layer for Todoist',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();

  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        {authed ? (
          <div className="flex h-screen flex-col md:flex-row">
            <Sidebar />
            <MobileTopBar />
            <main className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
              <div className="mx-auto max-w-5xl px-4 py-4 md:px-6 md:py-8">
                {children}
              </div>
            </main>
            <MobileBottomTabs />
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
