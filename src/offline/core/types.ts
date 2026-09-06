import type {
  Id,
  IsoInstant,
  MutationEnvelope,
  ReflectionPayload,
  ReflectionPreferences,
  ReflectionRecord,
  SessionRecord,
} from '@/domain/contracts';

export interface AccountScope {
  accountId: Id;
  generation: Id;
}
/** Browser identity observation; temporary unavailability must not discard an editor. */
export type AccountVerification = 'verified' | 'unavailable' | 'signed_out' | 'different_account';
export type Intent =
  | { kind: 'practices'; payload: { values: Record<Id, boolean | number> } }
  | { kind: 'completion'; payload: { performedAt: IsoInstant } }
  | { kind: 'completion_undo'; payload: Record<string, never> }
  | { kind: 'reflection'; payload: ReflectionPayload };
export type Stream = 'session' | 'reflection';
export interface Snapshot {
  session: SessionRecord;
  journeyTitle: string;
  reflection: ReflectionRecord | null;
  preferences: ReflectionPreferences;
  lastSyncedAt: IsoInstant;
  clock: { serverNow: IsoInstant; capturedAt: IsoInstant; simulated: boolean };
}
/** Invalid/incomplete input is stored verbatim, separately from validated intents. */
export interface RawDraft {
  numericValues?: Record<Id, string>;
  reflection?: { text: string; moods: string[] };
}
export interface EnqueueInput {
  operationId: Id;
  sessionId: Id;
  scheduleVersionId: Id;
  baseRevision: number;
  expectedLocalHead: Id | null;
  intent: Intent;
}
export interface Conflict {
  /** Binds a user choice to exactly the comparison that was displayed. */
  comparisonId: Id;
  code: string;
  currentSession: SessionRecord | null;
  currentReflection: ReflectionRecord | null;
  /** False means reconnect/read failed; a missing record has not been established. */
  currentAvailable: boolean;
}
export interface QueueOperation extends EnqueueInput {
  accountId: Id;
  stream: Stream;
  sequence: number;
  createdAt: IsoInstant;
  state: 'queued' | 'sending' | 'conflict' | 'review_required';
  predecessorId: Id | null;
  request: MutationEnvelope<Intent['payload']> | null;
  attempts: number;
  attemptedAt: IsoInstant | null;
  retryAfter: IsoInstant | null;
  conflict: Conflict | null;
}
export interface LocalView {
  snapshot: Snapshot;
  /** Local feedback only. Never feed projected state into canonical progress metrics. */
  projectedSession: SessionRecord;
  projectedReflection: ReflectionPayload;
  draft: RawDraft | null;
  draftRevision: number;
  operations: QueueOperation[];
  heads: Record<Stream, Id | null>;
}
export interface DeviceState {
  /** Compare-and-set token for account binding, even when no account is active. */
  bindingGeneration: Id;
  scope: AccountScope | null;
  /** Account/generation management only; shared mode still rejects every private read/write. */
  managementScope: AccountScope | null;
  sharedDevice: boolean;
  quarantined: boolean;
  pendingOperations: number;
  pendingDrafts: number;
  locksAvailable: boolean;
}
export interface FlushResult {
  acknowledged: number;
  pending: number;
  blocked: number;
  reason:
    | 'drained'
    | 'not_leader'
    | 'offline'
    | 'auth'
    | 'conflict'
    | 'retry'
    | 'storage'
    | 'unsupported'
    | 'account_changed'
    | 'aborted';
  retryAt: IsoInstant | null;
}
export type Resolution =
  | {
      kind: 'use_server';
      expectedComparisonId: Id;
      expectedOperationIds: Id[];
      expectedDraftRevision: number;
    }
  | {
      kind: 'submit_reviewed';
      expectedComparisonId: Id;
      expectedOperationIds: Id[];
      expectedDraftRevision: number;
      currentRevision: number;
      /** Ordered, explicitly reviewed replacements; preserve unqueued raw draft input. */
      replacements: Array<{ operationId: Id; intent: Intent }>;
    };
export type ClearAction = 'synced' | 'discard_confirmed';
export type ReplayReply =
  | { kind: 'session'; session: SessionRecord }
  | { kind: 'reflection'; sessionId: Id; revision: number; updatedAt: IsoInstant };
export interface ReplayTransport {
  identity(signal: AbortSignal): Promise<{ accountId: Id; now: IsoInstant }>;
  send(scope: AccountScope, operation: QueueOperation, signal: AbortSignal): Promise<ReplayReply>;
  current(
    scope: AccountScope,
    operation: QueueOperation,
    signal: AbortSignal,
  ): Promise<Omit<Conflict, 'comparisonId'>>;
}
export interface CoreOptions {
  /** Only override for an isolated browser test database. */
  databaseName?: string;
  transport?: ReplayTransport;
  now?: () => IsoInstant;
}
export interface OfflineCore {
  bindAccount(
    accountId: Id,
    options?: { discardPrevious?: boolean; expectedGeneration?: Id },
  ): Promise<AccountScope>;
  getDeviceState(): Promise<DeviceState>;
  saveSnapshot(scope: AccountScope, snapshot: Snapshot): Promise<void>;
  saveDraft(
    scope: AccountScope,
    sessionId: Id,
    draft: RawDraft | null,
    expectedRevision: number,
  ): Promise<number>;
  enqueue(scope: AccountScope, input: EnqueueInput): Promise<QueueOperation>;
  read(scope: AccountScope, sessionId: Id): Promise<LocalView | null>;
  listSavedSessions(scope: AccountScope): Promise<LocalView[]>;
  flush(scope: AccountScope, signal?: AbortSignal): Promise<FlushResult>;
  /** Refresh comparison without changing intent or attempted envelopes. */
  refreshConflict(scope: AccountScope, operationId: Id, signal?: AbortSignal): Promise<void>;
  resolve(scope: AccountScope, operationId: Id, choice: Resolution): Promise<void>;
  clearAccount(scope: AccountScope, action: ClearAction): Promise<void>;
  setSharedDevice(
    scope: AccountScope,
    enabled: boolean,
    action?: ClearAction,
  ): Promise<AccountScope>;
  /** ID-only invalidations; always call read/getDeviceState again before rendering. */
  subscribe(scope: AccountScope, changed: () => void): () => void;
  close(): void;
}
