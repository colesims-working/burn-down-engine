'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, ArrowRight, RefreshCw, Sparkles, Zap, Check, X } from 'lucide-react';

const STEPS = [
  { title: 'Welcome to Burn-Down Engine', description: 'Your AI-assisted GTD system. Let\'s set up in 3 steps.', icon: Flame },
  { title: 'Sync with Todoist', description: 'Pull your existing tasks and projects.', icon: RefreshCw },
  { title: 'Clarify your inbox', description: 'AI will help turn messy captures into clear next actions.', icon: Sparkles },
  { title: 'Ready to engage', description: 'Your tasks are organized. Start executing.', icon: Zap },
];

export function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  // Detect first run: no tasks synced
  useEffect(() => {
    const dismissed = localStorage.getItem('onboarding-dismissed');
    if (dismissed) return;

    async function check() {
      try {
        const res = await fetch('/api/todoist?action=sync-state');
        if (!res.ok) return;
        const state = await res.json();
        if (!state.lastFullSync && !state.lastInboxSync) {
          setVisible(true);
        }
      } catch {}
    }
    check();
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem('onboarding-dismissed', '1');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-all' }),
      });
      if (res.ok) setStep(2);
    } catch {} finally { setSyncing(false); }
  };

  const handleClarify = () => {
    dismiss();
    router.push('/clarify');
  };

  const handleEngage = () => {
    dismiss();
    router.push('/engage');
  };

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-2xl">
        <button onClick={dismiss} className="absolute right-4 top-4 p-1 rounded-lg hover:bg-accent text-muted-foreground">
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">{current.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
        </div>

        {/* Step progress */}
        <div className="my-6 flex justify-center gap-2">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 w-8 rounded-full ${i <= step ? 'bg-primary' : 'bg-secondary'}`} />
          ))}
        </div>

        <div className="flex justify-center gap-3">
          {step === 0 && (
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Get Started <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === 1 && (
            <button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
          {step === 2 && (
            <button onClick={handleClarify} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Sparkles className="h-4 w-4" /> Clarify Inbox
            </button>
          )}
          {step === 3 && (
            <button onClick={handleEngage} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Zap className="h-4 w-4" /> Start Engaging
            </button>
          )}
        </div>

        <button onClick={dismiss} className="mt-4 block w-full text-center text-xs text-muted-foreground hover:text-foreground">
          Skip setup
        </button>
      </div>
    </div>
  );
}
