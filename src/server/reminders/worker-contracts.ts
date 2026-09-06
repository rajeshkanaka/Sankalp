import type { PushResult, PushSubscriptionTarget } from './transport-contracts';

export interface ReminderLease {
  jobId: string;
  leaseToken: string;
  leaseUntil: string;
}
export type PreparedReminder =
  | { ready: false }
  | {
      ready: true;
      jobId: string;
      leaseToken: string;
      attempt: number;
      eventId: string;
      journeyId: string | null;
      sessionId: string | null;
      subscriptionId: string;
      subscriptionGeneration: number;
      expiresAt: string;
      simulated: boolean;
      journeyTitle: string | null;
      subscription: PushSubscriptionTarget;
    };
export interface ReminderWorkerStore {
  claim(now: string, limit: number, simulated: boolean): Promise<ReminderLease[]>;
  prepare(lease: ReminderLease, now: string, simulated: boolean): Promise<PreparedReminder>;
  settle(
    job: Extract<PreparedReminder, { ready: true }>,
    result: PushResult,
    now: string,
  ): Promise<boolean>;
  dueClosures(now: string, limit: number): Promise<string[]>;
  closeSession(sessionId: string, now: string): Promise<boolean>;
  heartbeat(): Promise<void>;
  close(): Promise<void>;
}
