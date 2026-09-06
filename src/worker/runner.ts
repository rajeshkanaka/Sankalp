import { createHash } from 'node:crypto';

import type { PushResult, PushTransport } from '../server/reminders/transport-contracts.js';
import type {
  PreparedReminder,
  ReminderLease,
  ReminderWorkerStore,
} from '../server/reminders/worker-contracts.js';
import { checkId, checkInstant, checkLease, checkPrepared, checkResult } from './validation.js';

type ReadyReminder = Extract<PreparedReminder, { ready: true }>;

export interface WorkerOptions {
  store: ReminderWorkerStore;
  transport: PushTransport;
  now: () => string;
  simulated: boolean;
  signal?: AbortSignal;
}

export interface WorkerCounts {
  claimed: number;
  prepared: number;
  sent: number;
  settled: number;
  skipped: number;
  accepted: number;
  terminalFailures: number;
  transientFailures: number;
  uncertain: number;
  closures: number;
  operationalFailures: number;
}

export function reminderTag(job: ReadyReminder): string {
  return createHash('sha256')
    .update(
      JSON.stringify([job.sessionId ?? job.jobId, job.subscriptionId, job.subscriptionGeneration]),
    )
    .digest('base64url')
    .slice(0, 32);
}

export function reminderPayload(job: ReadyReminder, tag = reminderTag(job)): string {
  const payload = {
    version: 1,
    eventId: job.eventId,
    journeyId: job.journeyId,
    sessionId: job.sessionId,
    subscriptionId: job.subscriptionId,
    subscriptionGeneration: job.subscriptionGeneration,
    tag,
    title: '',
    body: 'A moment for your commitment.',
  };
  const title =
    job.sessionId === null ? 'Test reminder' : (job.journeyTitle ?? 'Your practice reminder');
  let remaining = 3072 - Buffer.byteLength(JSON.stringify(payload), 'utf8');
  // Account for JSON escaping as well as UTF-8; preserve whole Unicode code points.
  for (const point of title) {
    const bytes = Buffer.byteLength(JSON.stringify(point), 'utf8') - 2;
    if (bytes > remaining) break;
    payload.title += point;
    remaining -= bytes;
  }
  return JSON.stringify(payload);
}

/** Counts describe durable settlements, except sent which means transport was invoked. */
export async function runOnce(options: WorkerOptions): Promise<WorkerCounts> {
  const { store, transport, simulated, signal } = options;
  const counts: WorkerCounts = {
    claimed: 0,
    prepared: 0,
    sent: 0,
    settled: 0,
    skipped: 0,
    accepted: 0,
    terminalFailures: 0,
    transientFailures: 0,
    uncertain: 0,
    closures: 0,
    operationalFailures: 0,
  };
  const now = () => checkInstant(options.now());
  const mode = simulated ? 'simulated' : 'real';
  let databaseWorked = false;
  const seen = new Set<string>();

  async function dispatch(lease: ReminderLease): Promise<void> {
    if (signal?.aborted) {
      counts.skipped++;
      return;
    }
    let job: ReadyReminder;
    try {
      const prepared = checkPrepared(await store.prepare(lease, now(), simulated));
      databaseWorked = true;
      if (!prepared.ready) {
        counts.skipped++;
        return;
      }
      if (
        prepared.jobId !== lease.jobId ||
        prepared.leaseToken !== lease.leaseToken ||
        prepared.simulated !== simulated
      )
        throw new Error('Worker preparation does not match its lease.');
      job = prepared;
      counts.prepared++;
    } catch {
      counts.operationalFailures++;
      return;
    }

    let outcome: PushResult | undefined;
    try {
      if (signal?.aborted) {
        outcome = {
          mode,
          httpStatus: null,
          kind: 'terminal_failure',
          reason: 'canceled',
          invalidateSubscription: false,
        };
      } else if (
        Date.parse(now()) >= Math.min(Date.parse(job.expiresAt), Date.parse(lease.leaseUntil))
      ) {
        outcome = {
          mode,
          httpStatus: null,
          kind: 'terminal_failure',
          reason: 'expired',
          invalidateSubscription: false,
        };
      } else {
        const tag = reminderTag(job);
        const payload = reminderPayload(job, tag);
        // A transport is bounded and owns its DNS/TLS deadline. Never retry inside this tick.
        counts.sent++;
        let result: PushResult | undefined;
        try {
          result = await transport.send(job.subscription, payload, tag, {
            expiresAt: job.expiresAt,
            signal,
          });
        } catch {
          // Invocation could have reached a provider. An exception cannot imply no delivery.
          outcome = {
            mode,
            httpStatus: null,
            kind: 'uncertain',
            reason: signal?.aborted ? 'aborted' : 'network',
          };
          counts.operationalFailures++;
        }
        if (result !== undefined) {
          outcome = checkResult(result);
          // A simulated receipt can never be relabeled real, even as an error.
          if (outcome.mode !== mode) throw new Error('Worker transport mode does not match.');
        }
      }
      if (!outcome) throw new Error('Worker transport returned no outcome.');
      const settled = await store.settle(job, outcome, now());
      databaseWorked = true;
      if (settled !== true) {
        counts.operationalFailures++;
        return;
      }
      counts.settled++;
      switch (outcome.kind) {
        case 'accepted':
          counts.accepted++;
          break;
        case 'terminal_failure':
          counts.terminalFailures++;
          break;
        case 'transient_failure':
          counts.transientFailures++;
          break;
        case 'uncertain':
          counts.uncertain++;
          break;
      }
    } catch {
      counts.operationalFailures++;
    }
  }

  while (!signal?.aborted && counts.claimed < 50) {
    let leases: ReminderLease[];
    try {
      const limit = Math.min(4, 50 - counts.claimed);
      const claimed = await store.claim(now(), limit, simulated);
      databaseWorked = true;
      if (!Array.isArray(claimed) || claimed.length > limit)
        throw new Error('Worker claim is invalid.');
      leases = claimed.map(checkLease);
      for (const lease of leases) {
        if (seen.has(lease.jobId)) throw new Error('Worker claim was repeated.');
        seen.add(lease.jobId);
      }
    } catch {
      counts.operationalFailures++;
      break;
    }
    counts.claimed += leases.length;
    if (leases.length === 0) break;
    await Promise.all(leases.map(dispatch));
  }

  // A failed send or claim must not prevent independent closure history from catching up.
  if (!signal?.aborted) {
    try {
      const sessions = await store.dueClosures(now(), 50);
      databaseWorked = true;
      if (!Array.isArray(sessions) || sessions.length > 50)
        throw new Error('Worker closures are invalid.');
      const ids = [...new Set(sessions.map(checkId))];
      for (let offset = 0; offset < ids.length && !signal?.aborted; offset += 4) {
        await Promise.all(
          ids.slice(offset, offset + 4).map(async (id) => {
            if (signal?.aborted) return;
            try {
              const inserted = await store.closeSession(id, now());
              databaseWorked = true;
              if (typeof inserted !== 'boolean')
                throw new Error('Worker closure result is invalid.');
              if (inserted) counts.closures++;
            } catch {
              counts.operationalFailures++;
            }
          }),
        );
      }
    } catch {
      counts.operationalFailures++;
    }
  }
  if (databaseWorked && !signal?.aborted) {
    try {
      await store.heartbeat();
    } catch {
      counts.operationalFailures++;
    }
  }
  return counts;
}
