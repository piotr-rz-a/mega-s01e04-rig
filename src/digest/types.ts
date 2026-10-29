export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  failures: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// Implemented by readNight(runsDir, night) in reader.ts.
// Invalid or missing nights return null; other filesystem errors propagate.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
