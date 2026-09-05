'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  OfflineError,
  getDeviceState,
  listSavedSessions,
  subscribe,
  type AccountScope,
  type LocalView,
} from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { formatPracticeDate } from './format';

export function OfflineSavedPage() {
  const [scope, setScope] = useState<AccountScope | null>(null);
  const [items, setItems] = useState<LocalView[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'locked' | 'unavailable'>('loading');
  const [message, setMessage] = useState('Checking this device…');

  const load = useCallback(async () => {
    try {
      const device = await getDeviceState();
      if (device.quarantined) {
        setScope(null);
        setItems([]);
        setState('locked');
        setMessage(
          'Local changes belong to another account and stay hidden. Sign in online to continue.',
        );
        return;
      }
      if (device.sharedDevice) {
        setScope(null);
        setItems([]);
        setState('locked');
        setMessage('Private offline storage is disabled on this shared device.');
        return;
      }
      if (!device.scope) {
        setScope(null);
        setItems([]);
        setState('locked');
        setMessage('Sign in online and open a practice before using it offline.');
        return;
      }
      const saved = await listSavedSessions(device.scope);
      setScope(device.scope);
      setItems(saved);
      setState('ready');
      setMessage('These practices were explicitly saved on this device.');
    } catch (error) {
      setScope(null);
      setItems([]);
      setState('unavailable');
      setMessage(
        error instanceof OfflineError
          ? error.message
          : 'This browser could not read private offline storage.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!scope) return;
    return subscribe(scope, () => void load());
  }, [load, scope]);

  return (
    <main className={styles.savedPage}>
      <header className={shared.header}>
        <h1>Practices saved on this device</h1>
        <p>{message}</p>
      </header>
      {state === 'loading' && <p role="status">Checking private local storage…</p>}
      {(state === 'locked' || state === 'unavailable') && (
        <section className={shared.panel}>
          <h2>No private practice is open</h2>
          <p>Reconnect to verify your account. Cached contents are never selected from a URL.</p>
          <a className={shared.button} href="/today">
            Reconnect to Sankalpa
          </a>
        </section>
      )}
      {state === 'ready' && items.length === 0 && (
        <section className={shared.panel}>
          <h2>No saved practices yet</h2>
          <p>Connect and open a practice first so this device can retain its explicit snapshot.</p>
          <a className={shared.button} href="/today">
            Open today’s practices
          </a>
        </section>
      )}
      {state === 'ready' && items.length > 0 && (
        <section aria-label="Saved practices" className={styles.savedList}>
          {items.map((view) => {
            const pending = view.operations.length;
            return (
              <article className={shared.panel} key={view.snapshot.session.id}>
                <h2>{view.snapshot.journeyTitle}</h2>
                <p>{formatPracticeDate(view.snapshot.session.practiceDate)}</p>
                <p className={shared.small}>
                  {pending
                    ? `${pending} change(s) waiting to sync.`
                    : `Last synced ${new Intl.DateTimeFormat('en', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(view.snapshot.lastSyncedAt))}.`}
                </p>
                <a
                  className={`${shared.button} ${shared.secondary}`}
                  href={`/journeys/${view.snapshot.session.journeyId}/sessions/${view.snapshot.session.id}`}
                >
                  Open saved practice
                </a>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
