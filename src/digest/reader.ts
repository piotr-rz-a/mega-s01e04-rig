import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function parseRun(line: string): Run | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at) ||
    !Number.isFinite(Date.parse(event.at)) ||
    typeof event.job !== 'string' || !event.job.trim() ||
    !(event.status === 'ok' || event.status === 'retry' || event.status === 'fail') ||
    !(event.owner === null || typeof event.owner === 'string') ||
    !(event.error === undefined || typeof event.error === 'string')
  ) return null;
  return {
    at: event.at,
    job: event.job,
    status: event.status,
    owner: event.owner,
    ...(typeof event.error === 'string' ? { error: event.error } : {}),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const rows = new Map<string, DigestRow>();
  const errorTimes = new Map<string, number>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  const lines = text === '' ? [] : text.split('\n');
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const event = parseRun(line);
    if (!event) {
      badLines++;
      continue;
    }
    counts[event.status]++;
    const row = rows.get(event.job) ?? {
      job: event.job, owner: event.owner, runs: 0, retries: 0, failures: 0,
      lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
    };
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.failures++;
    const time = Date.parse(event.at);
    if (time < Date.parse(row.firstAt)) row.firstAt = event.at;
    if (time >= Date.parse(row.lastAt)) {
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && time >= (errorTimes.get(event.job) ?? -Infinity)) {
      row.lastError = event.error;
      errorTimes.set(event.job, time);
    }
    rows.set(event.job, row);
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines,
    counts,
  };
};
