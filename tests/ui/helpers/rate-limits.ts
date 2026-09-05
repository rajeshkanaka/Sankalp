import { createHmac } from 'node:crypto';
import pg from 'pg';
import { loadGuardedLocalRuntime } from '../../fixtures/local';

// Only the isolated UI origin's synthetic sign-in counters are reset, never demo/user counters.
export async function resetUiSignInLimits(email: string) {
  const runtime = loadGuardedLocalRuntime();
  const origin = process.env.UI_ORIGIN;
  if (
    origin !== `http://localhost:${runtime.testPort}` ||
    !['ui-maya@example.test', 'ui-arun@example.test', 'ui-http-maya@example.test'].includes(email)
  )
    throw new Error('Only allocated synthetic UI sign-in counters can be reset.');
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret) throw new Error('Local rate secret is required.');
  const keys = [email, '127.0.0.1'].map((identity) =>
    createHmac('sha256', secret).update(`${origin}:${identity}`).digest('hex'),
  );
  const client = new pg.Client({ connectionString: runtime.adminDatabaseUrl });
  await client.connect();
  try {
    await client.query(
      "delete from app.rate_bucket where scope like 'sign-in-%' and key_hash=any($1::text[])",
      [keys],
    );
  } finally {
    await client.end();
  }
}
