// (2026-11-24) Why a song's row isn't on the pub sheet, when a write of it was tried and didn't go through. app_state "sheetRowFails" is
// { [placement id]: { error, at } }: the words of the last failed write of that song's row (Google's quota, the formula guard refusing a cell, a
// share the push rules refuse, a client with no share in the split). Written by every server-side write of a song's row that fails: the nightly
// auto-add and Possible placements' Add (lib/auto-add.js), "Add to pub sheet" (lib/auto-add.js putOnSheet) and the song editor's push
// (pages/api/sheets-push.js). Cleared when that song's own row is written (lib/sheet-push.js) or found on the sheet (putOnSheet). Songs to update
// shows the words beside "Not on the pub sheet" (GET /api/songs: songInfo.sheetFails), and To do's line counts them. Each statement changes only its
// own key inside the stored object, so two writes at once never undo each other. Server-only (the pure reader is sheetFailsOf).
import { sql as dbSql } from "./db";

export const SHEET_FAILS_KEY = "sheetRowFails";
const MAX_WORDS = 300;

// one song's failure, said in words (the newest replaces the one before)
export const noteSheetFail = (placementId, error, { sql = dbSql, now = new Date() } = {}) => {
  const id = String(placementId || "");
  if (!id || id.length > 64) return Promise.resolve(); // a song's id is 8 letters and digits (lib/id.js)
  const entry = { error: String(error || "The pub sheet write didn't go through.").slice(0, MAX_WORDS), at: new Date(now).toISOString() };
  return sql`INSERT INTO app_state (key, value, updated_at) VALUES (${SHEET_FAILS_KEY}, jsonb_build_object(${id}::text, ${JSON.stringify(entry)}::jsonb), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
};

// that song's row is on the sheet now: its failure goes (nothing happens when it has none)
export const clearSheetFail = (placementId, { sql = dbSql } = {}) => {
  const id = String(placementId || "");
  if (!id) return Promise.resolve();
  return sql`UPDATE app_state SET value = value - ${id}::text, updated_at = now() WHERE key = ${SHEET_FAILS_KEY} AND value -> ${id}::text IS NOT NULL`;
};

// the stored object as { [placement id]: { error, at } }, anything else in it left out. Pure
export function sheetFailsOf(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const out = {};
  for (const [id, e] of Object.entries(state)) {
    if (!e || typeof e !== "object" || typeof e.error !== "string" || !e.error.trim()) continue;
    out[id] = { error: e.error.slice(0, MAX_WORDS), at: String(e.at || "") };
  }
  return out;
}
