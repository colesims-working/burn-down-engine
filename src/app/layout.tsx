import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Sidebar } from '@/components/nav/sidebar';
import { isAuthenticated } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Burn-Down Engine',
  description: 'A daily-driven GTD intelligence layer for Todoist',
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
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-5xl px-6 py-8">
                {children}
              </div>
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
