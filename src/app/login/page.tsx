'use client';

import { useState, useRef, useEffect } from 'react';
import { Flame, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (data.success) {
        window.location.href = '/inbox';
      } else {
        setError(data.error || 'Invalid password');
        passwordRef.current?.focus();
      }
    } catch {
      setError('Connection error. Please check your network and try again.');
      passwordRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <Flame className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Burn-Down Engine</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily-driven GTD intelligence
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Login form">
          <div>
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              ref={passwordRef}
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              aria-label="Login password"
              aria-describedby={error ? 'login-error login-hint' : 'login-hint'}
              aria-invalid={!!error}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p id="login-hint" className="mt-2 text-center text-xs text-muted-foreground">
              Single-user app — enter your configured password
            </p>
          </div>

          {error && (
            <p id="login-error" className="flex items-center justify-center gap-1.5 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin inline" />Signing in...</> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
