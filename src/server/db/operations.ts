import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AppError } from '../errors';

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function idempotent<T>(
  client: pg.PoolClient,
  userId: string,
  operationId: string,
  operationType: string,
  input: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${userId}:${operationId}`,
  ]);
  const hash = fingerprint(input);
  const receipt = await client.query(
    'select operation_type, request_hash, response from app.operation_receipt where owner_id = $1 and operation_id = $2',
    [userId, operationId],
  );
  if (receipt.rows[0]) {
    if (receipt.rows[0].operation_type !== operationType || receipt.rows[0].request_hash !== hash)
      throw new AppError(
        409,
        'OPERATION_REUSED',
        'This change identifier was already used for different input.',
      );
    return receipt.rows[0].response as T;
  }
  const response = await operation();
  await client.query(
    'insert into app.operation_receipt(owner_id, operation_id, operation_type, request_hash, response) values($1,$2,$3,$4,$5)',
    [userId, operationId, operationType, hash, JSON.stringify(response)],
  );
  return response;
}
export function assertRevision(actual: number, expected: number, current: unknown) {
  if (actual !== expected)
    throw new AppError(
      409,
      'REVISION_CONFLICT',
      'This record changed on another device. Review the latest version before trying again.',
      current,
    );
}
