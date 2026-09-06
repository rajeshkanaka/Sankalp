export type PushSubscriptionTarget = Readonly<{
  endpoint: string;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;

export type PushOutcome =
  | { kind: 'accepted' }
  | {
      kind: 'terminal_failure';
      reason:
        | 'invalid_input'
        | 'endpoint_blocked'
        | 'subscription_gone'
        | 'provider_rejected'
        | 'tls_rejected'
        | 'expired'
        | 'canceled';
      invalidateSubscription: boolean;
    }
  | {
      kind: 'transient_failure';
      reason: 'dns_failure' | 'network_before_send' | 'provider_retry';
      retryAfterMs: number | null;
    }
  | {
      kind: 'uncertain';
      reason: 'timeout' | 'aborted' | 'network' | 'invalid_response';
    };

export type PushResult = PushOutcome &
  ({ mode: 'real'; httpStatus: number | null } | { mode: 'simulated'; httpStatus: null });

export interface PushTransport {
  send(
    subscription: PushSubscriptionTarget,
    payload: string,
    tag: string,
    options: Readonly<{ expiresAt: string; signal?: AbortSignal }>,
  ): Promise<PushResult>;
}
