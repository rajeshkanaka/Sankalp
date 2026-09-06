import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { getPageUser } from '@/server/auth/server';
import { getRuntimeInfo } from '@/server/config';
import { OfflineProvider } from '@/components/offline-provider';

export const dynamic = 'force-dynamic';
export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const user = await getPageUser();
  const runtime = getRuntimeInfo();
  return (
    <OfflineProvider accountId={user.id}>
      <AppShell email={user.email} demo={runtime.demo}>
        {children}
      </AppShell>
    </OfflineProvider>
  );
}
