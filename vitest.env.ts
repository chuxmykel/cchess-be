import { readFileSync } from 'node:fs';

/**
 * Reads a single key out of .env directly, without loading the rest of the
 * file into process.env - the test process must stay isolated from
 * dev-only vars like CLUSTER_WORKERS/REDIS_HOST, which (if present) flip on
 * multi-process cluster routing with no real cluster/Redis behind it,
 * hanging every GamesService integration test until timeout.
 */
export function readEnvFileValue(key: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(new URL('./.env', import.meta.url), 'utf8');
  } catch {
    return undefined;
  }
  const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim() || undefined;
}

/**
 * Same as readEnvFileValue, but throws instead of returning undefined - for
 * a key where silently proceeding without it would be worse than failing
 * loudly at config-load time (e.g. TEST_DB_NAME: see its own comment in
 * .env.example for what goes wrong if it's missing).
 */
export function requireEnvFileValue(key: string): string {
  const value = readEnvFileValue(key);
  if (!value) {
    throw new Error(`.env is missing ${key}, which is required. See .env.example.`);
  }
  return value;
}
