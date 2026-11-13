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
// A job that mustn't start again within `minutes` (2026-11-13: the Dashboard's background sheet pull): claimed in one
// statement, so two that start at once can't both get it. true = this caller has it; minutes 0 always does (it only
// marks the time, for the next caller's check).
export async function claimState(key, minutes, value = { at: new Date().toISOString() }) {
  if (!minutes) { await setState(key, value); return true; }
  const rows = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_state.updated_at < now() - ${minutes}::int * interval '1 minute' RETURNING key`;
  return rows.length > 0;
}
