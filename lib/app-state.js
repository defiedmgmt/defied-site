// A small key/value store for background jobs and the dashboard (app_state): when the cron last ran,
// which sheet tabs the last pull couldn't find, the pairs staff said aren't the same song, …
import { sql } from "./db";

export async function getState(key) {
  return (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null;
}
export async function setState(key, value) {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
