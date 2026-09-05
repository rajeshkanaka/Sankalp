import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError } from './errors';
import { getOrigin } from './config';
import { getApiUser, privateHeaders } from './auth/server';
import { consumeLimit } from './rate-limit';

export function assertSameOrigin(request: Request) {
  if (request.headers.get('origin') !== getOrigin())
    throw new AppError(403, 'ORIGIN_DENIED', 'Please reopen Sankalpa and try again.');
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new AppError(415, 'JSON_REQUIRED', 'Expected a JSON request.');
}
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'BODY_REQUIRED', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 131072) {
      await reader.cancel();
      throw new AppError(413, 'BODY_TOO_LARGE', 'Please shorten your input.');
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'The request could not be read.');
  }
  return schema.parse(data);
}
export async function handleApi(operation: () => Promise<unknown>) {
  const correlationId = randomUUID();
  try {
    return NextResponse.json(await operation(), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION',
            message: 'Please check the highlighted fields.',
            correlationId,
            fields: z.flattenError(error).fieldErrors,
          },
        },
        { status: 422, headers: privateHeaders },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            correlationId,
            ...(error.current ? { current: error.current } : {}),
          },
        },
        {
          status: error.status,
          headers: {
            ...privateHeaders,
            ...(error.status === 429
              ? { 'Retry-After': String(Math.max(1, Math.min(3600, error.retryAfter ?? 60))) }
              : {}),
          },
        },
      );
    console.error(JSON.stringify({ event: 'request_failed', correlationId }));
    return NextResponse.json(
      {
        error: {
          code: 'UNAVAILABLE',
          message: 'Your change was not saved. Please try again.',
          correlationId,
        },
      },
      { status: 503, headers: privateHeaders },
    );
  }
}
export async function authenticated<T>(
  request: Request,
  schema: z.ZodType<T>,
  operation: (userId: string, body: T) => Promise<unknown>,
) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const user = await getApiUser();
    await consumeLimit('write-minute', user.id);
    return operation(user.id, await readJson(request, schema));
  });
}
