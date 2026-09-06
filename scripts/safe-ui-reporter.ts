import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestStatus,
} from '@playwright/test/reporter';

type SafeRunStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'INTERRUPTED';
type SafeStatus = SafeRunStatus | 'NOT_RUN';

interface ReporterResultLike {
  status: TestStatus;
  duration: number;
  retry: number;
}

interface ReporterTestLike {
  title: string;
  location: { file: string; line: number };
  parent: { project(): { name: string } | undefined };
  results: ReporterResultLike[];
}

interface SummaryInput {
  sourceSha: string;
  generatedAt: Date;
  runStatus: FullResult['status'];
  rootDir: string;
  tests: ReporterTestLike[];
}

export interface SafeUiSummary {
  sourceSha: string;
  generatedAt: string;
  status: SafeStatus;
  tests: Array<{
    sourceFile: string;
    line: number;
    project: string;
    title: string;
    actualStatus: SafeStatus;
    attempts: Array<{
      actualStatus: SafeStatus;
      durationMs: number;
      retry: number;
    }>;
  }>;
}

function safeRunStatus(status: FullResult['status']): SafeRunStatus {
  switch (status) {
    case 'passed':
      return 'PASSED';
    case 'failed':
      return 'FAILED';
    case 'timedout':
      return 'TIMED_OUT';
    case 'interrupted':
      return 'INTERRUPTED';
  }
}

function safeTestStatus(status: TestStatus): SafeStatus {
  switch (status) {
    case 'passed':
      return 'PASSED';
    case 'failed':
      return 'FAILED';
    case 'timedOut':
      return 'TIMED_OUT';
    case 'interrupted':
      return 'INTERRUPTED';
    case 'skipped':
      return 'NOT_RUN';
  }
}

function relativeSourceFile(rootDir: string, file: string): string {
  const sourceFile = relative(rootDir, file);
  if (
    sourceFile === '' ||
    sourceFile === '..' ||
    sourceFile.startsWith(`..${sep}`) ||
    isAbsolute(sourceFile)
  ) {
    return basename(file);
  }
  return sourceFile.split(sep).join('/');
}

export function summarizeRun(input: SummaryInput): SafeUiSummary {
  const tests = input.tests.map((test) => {
    const attempts = test.results.map((result) => ({
      actualStatus: safeTestStatus(result.status),
      durationMs: result.duration,
      retry: result.retry,
    }));
    return {
      sourceFile: relativeSourceFile(input.rootDir, test.location.file),
      line: test.location.line,
      project: test.parent.project()?.name ?? 'unknown',
      title: test.title,
      actualStatus: attempts.at(-1)?.actualStatus ?? 'NOT_RUN',
      attempts,
    };
  });
  const hasExecutedAttempt = tests.some((test) =>
    test.attempts.some((attempt) => attempt.actualStatus !== 'NOT_RUN'),
  );

  return {
    sourceSha: input.sourceSha,
    generatedAt: input.generatedAt.toISOString(),
    status:
      input.runStatus === 'passed' && !hasExecutedAttempt
        ? 'NOT_RUN'
        : safeRunStatus(input.runStatus),
    tests,
  };
}

const SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

export function resolveSourceSha(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): string {
  const githubSha = environment.GITHUB_SHA?.trim();
  if (githubSha && SHA_PATTERN.test(githubSha)) return githubSha;

  try {
    const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (SHA_PATTERN.test(repositorySha)) return repositorySha;
  } catch {
    // The fixed message below deliberately excludes command output and environment values.
  }

  throw new Error('Unable to determine source SHA.');
}

export default class SafeUiReporter implements Reporter {
  private rootDir = process.cwd();
  private tests: TestCase[] = [];

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.configFile ? dirname(resolve(config.configFile)) : process.cwd();
    this.tests = suite.allTests();
  }

  onEnd(result: FullResult): void {
    const summary = summarizeRun({
      sourceSha: resolveSourceSha(process.env, this.rootDir),
      generatedAt: new Date(),
      runStatus: result.status,
      rootDir: this.rootDir,
      tests: this.tests,
    });
    const outputFile = resolve(this.rootDir, 'artifacts/ui/summary.json');
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
