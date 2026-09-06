'use client';

import type { ReactNode } from 'react';
import { OfflineAccountBoundary } from '@/offline/ui';
import { ensurePublicShell } from '@/service-worker/register';

export function OfflineProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  return (
    <OfflineAccountBoundary accountId={accountId} ensureOfflineReady={ensurePublicShell}>
      {children}
    </OfflineAccountBoundary>
  );
}
