'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { requestJson } from './api';
import { RequestErrorMessage } from './request-error';
import styles from '@/styles/sanctuary.module.css';

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  return (
    <nav
      className={mobile ? styles.bottomNav : styles.nav}
      aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}
    >
      <Link
        prefetch={false}
        className={styles.navLink}
        href="/today"
        aria-current={path === '/today' ? 'page' : undefined}
      >
        <Icon name="today" />
        Today
      </Link>
      <Link
        prefetch={false}
        className={styles.navLink}
        href="/journeys"
        aria-current={path.startsWith('/journeys') || path === '/setup' ? 'page' : undefined}
      >
        <Icon name="journey" />
        Journeys
      </Link>
      <Link
        prefetch={false}
        className={styles.navLink}
        href="/calendar"
        aria-current={path === '/calendar' ? 'page' : undefined}
      >
        <Icon name="calendar" />
        Calendar
      </Link>
      <span className={styles.navUnavailable} aria-disabled="true">
        <Icon name="journal" />
        Journal<small>Not available yet</small>
      </span>
    </nav>
  );
}

export function AppShell({
  children,
  email,
  demo,
}: {
  children: ReactNode;
  email?: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      await requestJson('/api/auth/sign-out', 'POST', {});
      router.replace('/welcome');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Could not sign out. Try again.'));
      setSigningOut(false);
    }
  }
  const brand = (
    <Link prefetch={false} className={styles.brand} href="/today">
      <Icon name="light" width="31" height="31" />
      Sankalpa
    </Link>
  );
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <aside className={styles.rail}>
        {brand}
        <p className={styles.railCaption}>A space for your practice.</p>
        <Navigation />
        <div className={styles.railFooter}>
          Your intention.
          <br />
          Your own rhythm.
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}>{brand}</div>
          <span className={styles.topbarTitle}>Your personal practice space</span>
          <div className={styles.topbarTools}>
            {email && <span className={styles.userEmail}>{email}</span>}
            <button
              type="button"
              className={styles.accountButton}
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          {demo && <span className={styles.demo}>Demo data · simulated clock</span>}
        </header>
        <main id="main-content" className={styles.content} tabIndex={-1}>
          <RequestErrorMessage error={error} />
          {children}
        </main>
      </div>
      <Navigation mobile />
    </div>
  );
}
