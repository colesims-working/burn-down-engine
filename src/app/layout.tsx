import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Sidebar } from '@/components/nav/sidebar';
import { MobileTopBar, MobileBottomTabs } from '@/components/nav/mobile-nav';
import { TrustProvider } from '@/components/providers/trust-provider';
import { Toaster } from '@/components/shared/toaster';
import { UndoIndicator } from '@/components/shared/undo-indicator';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { CommandPalette } from '@/components/shared/command-palette';
import { ShortcutsModal } from '@/components/shared/shortcuts-modal';
import { OnboardingWizard } from '@/components/shared/onboarding-wizard';
import { LearningIndicator } from '@/components/shared/learning-indicator';
import { isAuthenticated } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Burn-Down Engine',
  description: 'A daily-driven GTD intelligence layer for Todoist',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Burn-Down' },
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        {authed ? (
          <ThemeProvider>
          <TrustProvider>
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
            <Toaster />
            <UndoIndicator />
            <LearningIndicator />
            <CommandPalette />
            <ShortcutsModal />
            <OnboardingWizard />
          </TrustProvider>
          </ThemeProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
