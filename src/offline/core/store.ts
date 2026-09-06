import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { AccountScope, QueueOperation, RawDraft, Snapshot } from './types';
import { MAX_UNPINNED_SESSIONS, OfflineError, storageError } from './model';

export interface DeviceMeta {
  key: 'device';
  activeAccountId: string | null;
  quarantinedAccountId: string | null;
  generation: string;
  sharedDevice: boolean;
  sequence: number;
}
interface SessionRow {
  accountId: string;
  sessionId: string;
  snapshot: Snapshot;
  accessedAt: string;
}
interface DraftRow {
  accountId: string;
  sessionId: string;
  draft: RawDraft | null;
  revision: number;
}
export interface OperationRow extends QueueOperation {
  inputKey: string;
}
interface OfflineDB extends DBSchema {
  meta: { key: string; value: DeviceMeta };
  sessions: { key: [string, string]; value: SessionRow; indexes: { account: string } };
  drafts: { key: [string, string]; value: DraftRow; indexes: { account: string } };
  operations: { key: [string, string]; value: OperationRow; indexes: { account: string } };
}
export type Transaction = IDBPTransaction<
  OfflineDB,
  ['meta', 'sessions', 'drafts', 'operations'],
  'readwrite'
>;
export const freshMeta = (): DeviceMeta => ({
  key: 'device',
  activeAccountId: null,
  quarantinedAccountId: null,
  generation: crypto.randomUUID(),
  sharedDevice: false,
  sequence: 0,
});
export function checkScope(meta: DeviceMeta, scope: AccountScope, allowShared = false): void {
  if (
    meta.activeAccountId !== scope.accountId ||
    meta.generation !== scope.generation ||
    meta.quarantinedAccountId
  )
    throw new OfflineError(
      'ACCOUNT_CHANGED',
      'Local access changed. Verify your account before continuing.',
    );
  if (meta.sharedDevice && !allowShared)
    throw new OfflineError('SHARED_DEVICE', 'Private local storage is disabled on this device.');
}
export async function counts(
  tx: Transaction,
  accountId: string | null,
): Promise<{ operations: number; drafts: number }> {
  if (!accountId) return { operations: 0, drafts: 0 };
  return {
    operations: await tx.objectStore('operations').index('account').count(accountId),
    drafts: (await tx.objectStore('drafts').index('account').getAll(accountId)).filter(
      (row) => row.draft !== null,
    ).length,
  };
}
export async function purge(tx: Transaction): Promise<void> {
  await Promise.all([
    tx.objectStore('sessions').clear(),
    tx.objectStore('drafts').clear(),
    tx.objectStore('operations').clear(),
  ]);
}
export async function sessionOperations(
  tx: Transaction,
  accountId: string,
  sessionId?: string,
): Promise<OperationRow[]> {
  return (await tx.objectStore('operations').index('account').getAll(accountId))
    .filter((operation) => !sessionId || operation.sessionId === sessionId)
    .sort((a, b) => a.sequence - b.sequence);
}
export async function prune(tx: Transaction, accountId: string): Promise<void> {
  const operations = await sessionOperations(tx, accountId);
  const drafts = await tx.objectStore('drafts').index('account').getAll(accountId);
  const pinned = new Set([
    ...operations.map((row) => row.sessionId),
    ...drafts.filter((row) => row.draft !== null).map((row) => row.sessionId),
  ]);
  const unpinned = (await tx.objectStore('sessions').index('account').getAll(accountId))
    .filter((row) => !pinned.has(row.sessionId))
    .sort((a, b) => b.accessedAt.localeCompare(a.accessedAt));
  for (const row of unpinned.slice(MAX_UNPINNED_SESSIONS)) {
    await tx.objectStore('sessions').delete([accountId, row.sessionId]);
    await tx.objectStore('drafts').delete([accountId, row.sessionId]);
  }
}
export class Storage {
  private opened: Promise<IDBPDatabase<OfflineDB>> | undefined;
  private database: IDBPDatabase<OfflineDB> | undefined;
  private unavailable = false;
  constructor(
    private readonly name: string,
    private readonly invalidated: () => void,
  ) {}
  private open(): Promise<IDBPDatabase<OfflineDB>> {
    if (this.unavailable)
      return Promise.reject(
        new OfflineError('STORAGE_RELOAD_REQUIRED', 'Reload to reopen local storage.'),
      );
    if (!globalThis.indexedDB)
      return Promise.reject(
        new OfflineError('STORAGE_UNAVAILABLE', 'This browser cannot save offline changes.'),
      );
    if (!this.opened) {
      this.opened = new Promise((resolve, reject) => {
        const opening = openDB<OfflineDB>(this.name, 1, {
          upgrade(db) {
            db.createObjectStore('meta', { keyPath: 'key' });
            db.createObjectStore('sessions', { keyPath: ['accountId', 'sessionId'] }).createIndex(
              'account',
              'accountId',
            );
            db.createObjectStore('drafts', { keyPath: ['accountId', 'sessionId'] }).createIndex(
              'account',
              'accountId',
            );
            db.createObjectStore('operations', {
              keyPath: ['accountId', 'operationId'],
            }).createIndex('account', 'accountId');
          },
          blocked: () => {
            this.unavailable = true;
            this.invalidated();
            reject(
              new OfflineError(
                'STORAGE_BLOCKED',
                'Close older Sankalpa tabs and reload to open local storage.',
              ),
            );
          },
          blocking: () => {
            this.unavailable = true;
            this.database?.close();
            this.invalidated();
          },
          terminated: () => {
            this.unavailable = true;
            this.invalidated();
          },
        });
        opening.then((db) => {
          if (this.unavailable) {
            db.close();
            reject(new OfflineError('STORAGE_RELOAD_REQUIRED'));
          } else {
            this.database = db;
            resolve(db);
          }
        }, reject);
      });
    }
    return this.opened;
  }
  async run<T>(
    scope: AccountScope | null,
    action: (tx: Transaction, meta: DeviceMeta) => Promise<T>,
    allowShared = false,
  ): Promise<T> {
    let tx: Transaction | undefined;
    try {
      const db = await this.open();
      tx = db.transaction(['meta', 'sessions', 'drafts', 'operations'], 'readwrite');
      // Consume abort rejection immediately; still await the same promise before returning success.
      void tx.done.catch(() => undefined);
      const stored = await tx.objectStore('meta').get('device');
      const meta = stored ?? freshMeta();
      if (!stored) await tx.objectStore('meta').put(meta);
      if (scope) checkScope(meta, scope, allowShared);
      const result = await action(tx, meta);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx?.abort();
      } catch {
        /* It may already have committed or aborted. */
      }
      await tx?.done.catch(() => undefined);
      throw storageError(error);
    }
  }
  close(): void {
    this.unavailable = true;
    this.database?.close();
  }
}
