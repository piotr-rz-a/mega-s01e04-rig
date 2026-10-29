import type { DigestRow, NightDigest } from '../digest/types.js';

// Missing data is shown as —, never as an empty cell (styleguide).
const MISSING = '—';

// Retries of 3 or more, or any failure, are flagged (plan 2a).
function isFlagged(row: DigestRow): boolean {
  return row.retries >= 3 || row.failures > 0;
}

// Timestamps are shown exactly as the log wrote them, offset included (styleguide).
export function DigestPage({ digest }: { digest: NightDigest }) {
  const bad = digest.badLines;
  return (
    <>
      <h1>digest · {digest.night}</h1>

      <p class={bad > 0 ? 'warn' : 'mute'}>
        {bad} malformed line{bad === 1 ? '' : 's'}
      </p>

      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <caption class="mute">jobs in runs/{digest.night}.jsonl</caption>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first time</th>
              <th scope="col">last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={isFlagged(row) ? 'warn' : undefined}>
                <th scope="row">{row.job}</th>
                <td>{row.owner || MISSING}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>{row.lastStatus}</td>
                <td>{row.lastError || MISSING}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
