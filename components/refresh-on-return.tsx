'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Coins arrive by postback, sometimes minutes after the offer. When the user comes back
// to the tab, re-render the server page so the balance is current. The browser never adds coins.
export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') router.refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);
  return null;
}
