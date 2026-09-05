import { expect, it, vi } from 'vitest';
import { AppError } from '../../src/server/errors';
import { handleApi } from '../../src/server/http';

it('preserves an explicitly absent current reflection in a private conflict response', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await handleApi(async () => {
      throw new AppError(409, 'REVISION_CONFLICT', 'Review the current reflection.', null);
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'REVISION_CONFLICT', current: null },
    });
    expect(log).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it('rejects a changed account before replay while preserving existing online requests', async () => {
  const { assertExpectedAccount } = await import('../../src/server/http');
  const account = 'a0000000-0000-4000-8000-000000000001';
  expect(() =>
    assertExpectedAccount(new Request('http://localhost/api/sessions'), account),
  ).not.toThrow();
  expect(() =>
    assertExpectedAccount(
      new Request('http://localhost/api/sessions', { headers: { 'X-Sankalpa-Account': account } }),
      account,
    ),
  ).not.toThrow();
  expect(() =>
    assertExpectedAccount(
      new Request('http://localhost/api/sessions', {
        headers: { 'X-Sankalpa-Account': 'a0000000-0000-4000-8000-000000000002' },
      }),
      account,
    ),
  ).toThrow(expect.objectContaining({ status: 409, code: 'ACCOUNT_CHANGED' }));
});
