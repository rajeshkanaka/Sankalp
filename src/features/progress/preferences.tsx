'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProgressPreferences } from '@/domain/contracts';
import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import shared from '@/styles/sanctuary.module.css';

export function StreakPreference({ preferences }: { preferences: ProgressPreferences }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [checked, setChecked] = useState(preferences.hideStreaks);
  useEffect(() => setChecked(preferences.hideStreaks), [preferences.hideStreaks]);
  async function save(hideStreaks: boolean) {
    setPending(true);
    setError(null);
    try {
      const saved = await requestJson<ProgressPreferences>('/api/profile/preferences', 'PUT', {
        hideStreaks,
      });
      setChecked(saved.hideStreaks);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not save your preference. Try again.'),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <label className={shared.checkLabel}>
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(event) => void save(event.target.checked)}
        />
        <span>Hide streaks</span>
      </label>
      {pending && (
        <p role="status" className={shared.small}>
          Saving your preference…
        </p>
      )}
      <RequestErrorMessage error={error} />
    </div>
  );
}
