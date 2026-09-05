import type { ApiErrorBody } from '@/domain/contracts';

export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public correlationId?: string,
    public fields?: Record<string, string[]>,
    public current?: unknown,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export async function requestJson<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  operationId?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(operationId ? { 'Idempotency-Key': operationId } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RequestError(
      'Could not connect. Your entries are still here. Check your connection and try again.',
      'NETWORK_ERROR',
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      'The server returned an unreadable response. Your entries are still here. Try again.',
      'RESPONSE_ERROR',
    );
  }
  if (!response.ok) {
    const error = (data as Partial<ApiErrorBody>)?.error;
    throw new RequestError(
      error?.message ?? 'This change could not be saved. Your entries are still here.',
      error?.code ?? 'REQUEST_ERROR',
      error?.correlationId,
      error?.fields,
      error?.current,
    );
  }
  return data as T;
}
