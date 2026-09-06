'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useOfflineAccount } from '@/offline/ui';

/** Online-only editors still participate in deliberate account/privacy changes. */
export function useOnlineEditorCheckpoint(unstored: boolean) {
  const { frozen, isFrozen, registerEditor } = useOfflineAccount();
  const dirty = useRef(unstored);
  dirty.current = unstored;
  const requests = useRef(new Set<Promise<unknown>>());
  useEffect(
    () =>
      registerEditor({
        hasUnstoredInput: () => dirty.current || requests.current.size > 0,
        settle: async () => {
          await Promise.allSettled([...requests.current]);
        },
      }),
    [registerEditor],
  );
  const trackRequest = useCallback(
    async <T>(send: () => Promise<T>): Promise<T> => {
      if (isFrozen()) throw new Error('Finish or cancel the account action before saving.');
      const request = send();
      requests.current.add(request);
      try {
        return await request;
      } finally {
        requests.current.delete(request);
      }
    },
    [isFrozen],
  );
  return { frozen, isFrozen, trackRequest };
}
