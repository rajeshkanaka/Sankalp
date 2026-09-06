import { describe, expect, it } from 'vitest';
import { bindLoopback } from '../../scripts/docker-loopback.mjs';

describe('project-scoped Supabase Docker binding', () => {
  it('binds every publication explicitly to loopback and preserves unrelated arguments', () => {
    expect(
      bindLoopback([
        'create',
        '--name',
        'test',
        '-p',
        '54321:8000',
        '-e',
        'EXAMPLE=value',
        '-p',
        '54324:8025/tcp',
        'image',
      ]),
    ).toEqual([
      'create',
      '--name',
      'test',
      '-p',
      '127.0.0.1:54321:8000',
      '-e',
      'EXAMPLE=value',
      '-p',
      '127.0.0.1:54324:8025/tcp',
      'image',
    ]);
  });
  it('preserves an explicitly loopback-bound mapping', () => {
    expect(bindLoopback(['create', '-p', '127.0.0.1:54322:5432'])).toEqual([
      'create',
      '-p',
      '127.0.0.1:54322:5432',
    ]);
  });
  it.each(['0.0.0.0:54322:5432', '[::]:54322:5432', '5432', ''])(
    'rejects unsafe or implicit mapping %s',
    (mapping) => {
      expect(() => bindLoopback(['create', '-p', mapping])).toThrow(/port mapping/);
    },
  );
  it.each(['-P', '--publish-all', '--publish=54322:5432', '-p54322:5432'])(
    'rejects changed publication syntax %s',
    (flag) => {
      expect(() => bindLoopback(['create', flag])).toThrow(/contract/);
    },
  );
  it('passes inspection, start, stop and volume commands through unchanged', () => {
    for (const args of [
      ['inspect', 'container'],
      ['start', 'container'],
      ['stop', 'container'],
      ['volume', 'inspect', 'data'],
    ])
      expect(bindLoopback(args)).toEqual(args);
  });
});
