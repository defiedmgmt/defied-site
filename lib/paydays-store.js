// The payday schedule in app_state 'paydays' (lib/paydays.js says what's in it). The seed is used while there's no row; the first save
// stores the seed with that save on top, and a removal before any save stores the seed without it, so previews, tests and the live site
// all start from the same real dates and nothing has to be run by hand. Each save merges only its own keys in one statement, so two
// saves at once both stay. Server-only.
import { sql } from "./db";
import { PAYDAYS_KEY, SEED, normalizePaydays, weekPaydays } from "./paydays";

// -> { dates, who, done } (lib/paydays.js normalizePaydays)
export async function readPaydays() {
  const [r] = await sql`SELECT value FROM app_state WHERE key = ${PAYDAYS_KEY}`;
  return normalizePaydays(r?.value ?? null);
}
// entries: { "date:bmi:2027-08-20": {}, "who:<clientId>": ["bmi"], "done:bmi:2026-11-20": { by, at } }
export async function savePaydays(entries) {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${PAYDAYS_KEY}, ${JSON.stringify({ ...SEED, ...entries })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || ${JSON.stringify(entries)}::jsonb, updated_at = now()`;
}
export async function removePayday(k) {
  const rest = { ...SEED }; delete rest[k];
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${PAYDAYS_KEY}, ${JSON.stringify(rest)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value - ${k}::text, updated_at = now()`;
}
// the paydays in the week that starts on a Monday (the Monday digest), source and day only
export async function weekOfPaydays(monday) {
  return weekPaydays(await readPaydays(), monday);
}
