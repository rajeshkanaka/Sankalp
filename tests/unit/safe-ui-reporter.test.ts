import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, FullResult, Suite } from '@playwright/test/reporter';
import { describe, expect, it, vi } from 'vitest';

import SafeUiReporter, { resolveSourceSha, summarizeRun } from '../../scripts/safe-ui-reporter';

const SECRET = 'token_hash=super-secret-callback-value';

function project(name: string) {
  return { project: () => ({ name }) };
}

describe('safe UI report summary', () => {
  it('retains the run-start revision when Git context changes during a run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sankalpa-reporter-'));
    const original = '0123456789abcdef0123456789abcdef01234567';
    try {
      vi.stubEnv('GITHUB_SHA', original);
      const reporter = new SafeUiReporter();
      reporter.onBegin(
        { configFile: join(directory, 'playwright.config.ts') } as FullConfig,
        { allTests: () => [] } as unknown as Suite,
      );
      vi.stubEnv('GITHUB_SHA', 'fedcba9876543210fedcba9876543210fedcba98');
      reporter.onEnd({ status: 'passed' } as FullResult);
      const summary = JSON.parse(
        readFileSync(join(directory, 'artifacts/ui/summary.json'), 'utf8'),
      );
      expect(summary.sourceSha).toBe(original);
      expect(summary.status).toBe('NOT_RUN');
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves every retry attempt and maps explicit non-passing statuses', () => {
    const summary = summarizeRun({
      generatedAt: new Date('2026-09-06T01:02:03.004Z'),
      rootDir: '/workspace',
      runStatus: 'interrupted',
      sourceSha: '0123456789abcdef0123456789abcdef01234567',
      tests: [
        {
          title: 'eventually succeeds',
          location: { file: '/workspace/tests/ui/m1.spec.ts', line: 42 },
          parent: project('chromium'),
          results: [
            { status: 'failed', duration: 301, retry: 0 },
            { status: 'passed', duration: 211, retry: 1 },
          ],
        },
        {
          title: 'not available in this project',
          location: { file: '/workspace/tests/ui/m2.spec.ts', line: 9 },
          parent: project('webkit'),
          results: [{ status: 'skipped', duration: 0, retry: 0 }],
        },
        {
          title: 'does not finish before its deadline',
          location: { file: '/workspace/tests/ui/m3.spec.ts', line: 17 },
          parent: project('firefox'),
          results: [
            { status: 'timedOut', duration: 30_000, retry: 0 },
            { status: 'interrupted', duration: 15, retry: 1 },
          ],
        },
      ],
    });

    expect(summary).toEqual({
      sourceSha: '0123456789abcdef0123456789abcdef01234567',
      generatedAt: '2026-09-06T01:02:03.004Z',
      status: 'INTERRUPTED',
      tests: [
        {
          sourceFile: 'tests/ui/m1.spec.ts',
          line: 42,
          project: 'chromium',
          title: 'eventually succeeds',
          actualStatus: 'PASSED',
          attempts: [
            { actualStatus: 'FAILED', durationMs: 301, retry: 0 },
            { actualStatus: 'PASSED', durationMs: 211, retry: 1 },
          ],
        },
        {
          sourceFile: 'tests/ui/m2.spec.ts',
          line: 9,
          project: 'webkit',
          title: 'not available in this project',
          actualStatus: 'NOT_RUN',
          attempts: [{ actualStatus: 'NOT_RUN', durationMs: 0, retry: 0 }],
        },
        {
          sourceFile: 'tests/ui/m3.spec.ts',
          line: 17,
          project: 'firefox',
          title: 'does not finish before its deadline',
          actualStatus: 'INTERRUPTED',
          attempts: [
            { actualStatus: 'TIMED_OUT', durationMs: 30_000, retry: 0 },
            { actualStatus: 'INTERRUPTED', durationMs: 15, retry: 1 },
          ],
        },
      ],
    });
  });

  it('serializes only allowlisted fields from secret-bearing Playwright results', () => {
    const secretBearingTest = {
      title: 'keeps a static title',
      location: { file: '/workspace/tests/ui/private.spec.ts', line: 7 },
      parent: project('chromium'),
      annotations: [{ type: 'secret', description: SECRET }],
      url: `http://localhost/callback?${SECRET}`,
      results: [
        {
          status: 'failed' as const,
          duration: 12,
          retry: 0,
          steps: [{ title: `navigate ${SECRET}` }],
          error: { message: `callback failed: ${SECRET}` },
          errors: [{ stack: `Error: ${SECRET}` }],
          stdout: [`stdout ${SECRET}`],
          stderr: [`stderr ${SECRET}`],
          attachments: [{ name: SECRET, path: `/tmp/${SECRET}` }],
          request: { url: `http://localhost/request?${SECRET}`, cookies: SECRET },
          response: { url: `http://localhost/response?${SECRET}` },
        },
      ],
    };
    const summary = summarizeRun({
      generatedAt: new Date('2026-09-06T01:02:03.004Z'),
      rootDir: '/workspace',
      runStatus: 'failed',
      sourceSha: 'abcdef0123456789abcdef0123456789abcdef01',
      tests: [secretBearingTest],
    });

    expect(Object.keys(summary)).toEqual(['sourceSha', 'generatedAt', 'status', 'tests']);
    expect(Object.keys(summary.tests[0])).toEqual([
      'sourceFile',
      'line',
      'project',
      'title',
      'actualStatus',
      'attempts',
    ]);
    expect(Object.keys(summary.tests[0].attempts[0])).toEqual([
      'actualStatus',
      'durationMs',
      'retry',
    ]);

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain('super-secret-callback-value');
    expect(serialized).not.toContain('localhost');
    expect(serialized).not.toContain('callback failed');
    expect(serialized).not.toContain('stdout');
    expect(serialized).not.toContain('stderr');
    expect(serialized).not.toContain('attachments');
    expect(serialized).not.toContain('annotations');
    expect(serialized).not.toContain('steps');
    expect(serialized).not.toContain('cookies');
  });

  it('reports zero-test and all-unrun passing invocations as not run', () => {
    const common = {
      generatedAt: new Date('2026-09-06T01:02:03.004Z'),
      rootDir: '/workspace',
      runStatus: 'passed' as const,
      sourceSha: 'abcdef0123456789abcdef0123456789abcdef01',
    };

    expect(summarizeRun({ ...common, tests: [] }).status).toBe('NOT_RUN');
    expect(
      summarizeRun({
        ...common,
        tests: [
          {
            title: 'never started',
            location: { file: '/workspace/tests/ui/m1.spec.ts', line: 2 },
            parent: project('chromium'),
            results: [],
          },
          {
            title: 'skipped',
            location: { file: '/workspace/tests/ui/m1.spec.ts', line: 3 },
            parent: project('chromium'),
            results: [{ status: 'skipped', duration: 0, retry: 0 }],
          },
        ],
      }).status,
    ).toBe('NOT_RUN');
  });

  it('accepts only a commit-shaped GITHUB_SHA', () => {
    expect(
      resolveSourceSha(
        { GITHUB_SHA: 'fedcba9876543210fedcba9876543210fedcba98' },
        '/does/not/need/git',
      ),
    ).toBe('fedcba9876543210fedcba9876543210fedcba98');

    expect(() =>
      resolveSourceSha({ GITHUB_SHA: `0123456-${SECRET}` }, '/definitely/not/a/git/repository'),
    ).toThrow('Unable to determine source SHA.');
  });
});
