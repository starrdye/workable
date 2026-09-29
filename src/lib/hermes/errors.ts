/**
 * hermes/errors.ts — Hermes run errors in plain words, for the status labels,
 * the Requests table and the bottleneck note.
 */

/** Hermes's raw run errors in plain words: "elapsed 50s > limit 45s" → "Timed out after 50s (limit 45s)". */
export function humanError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw.split('\n')[0].trim();
  const timeout = line.match(/elapsed\s+(\d+)s\s*>\s*limit\s+(\d+)s/i);
  if (timeout) return `Timed out after ${timeout[1]}s (limit ${timeout[2]}s)`;
  if (/pid \d+ not alive|worker crashed/i.test(line)) return 'Worker crashed before replying';
  if (/APITimeoutError|timed out/i.test(line)) return 'Model did not answer in time';
  return line;
}
