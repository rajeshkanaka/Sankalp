'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon } from './icons';
import { requestJson } from './api';
import { OfflineAccountControls } from '@/offline/ui';
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
      <Link
        prefetch={false}
        className={styles.navLink}
        href="/journal"
        aria-current={path === '/journal' ? 'page' : undefined}
      >
        <Icon name="journal" />
        Journal
      </Link>
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
  async function signOut() {
    await requestJson('/api/auth/sign-out', 'POST', {});
    window.location.replace('/welcome');
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
            <OfflineAccountControls compact onSignOut={signOut} />
          </div>
          {demo && <span className={styles.demo}>Demo data · simulated clock</span>}
        </header>
        <main id="main-content" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
      <Navigation mobile />
    </div>
  );
}
