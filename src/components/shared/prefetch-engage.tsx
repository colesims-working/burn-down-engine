'use client';

import { useEffect } from 'react';

/**
 * Silently prefetch engage data in the background so it's cached
 * when the user navigates to the Engage page. Uses the browser's
 * HTTP cache via a low-priority fetch.
 */
export function PrefetchEngage() {
  useEffect(() => {
    // Delay prefetch to avoid competing with the current page's initial loads
    const timer = setTimeout(() => {
      fetch('/api/todoist?action=engage', { priority: 'low' } as RequestInit).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
