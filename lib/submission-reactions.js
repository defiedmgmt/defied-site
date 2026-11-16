// (2026-11-16) Which website messages a staff save turned read or unread, so their ClickUp post can carry a ✅ while they're read
// (lib/clickup.js reactToMessage; pages/api/dashboard-data.js runs it once the save is in). Pure.
//   before: [{ id, read, clickup_message_id }] as the database has them now; after: the save's submissions [{ id, read }]
//   -> [{ id, messageId, on }]: on = true when it became read, false when it's unread again.
// A row the database doesn't have, or one with no ClickUp post (it came in before the post existed, or ClickUp was down), is
// left out, and so is one whose read didn't change. An id the save lists twice counts as its last entry, the one the database keeps.
export function readFlips(before, after) {
  const was = new Map((Array.isArray(before) ? before : []).map((r) => [String(r?.id), r]));
  const now = new Map((Array.isArray(after) ? after : []).filter((s) => s && s.id != null).map((s) => [String(s.id), !!s.read]));
  const out = [];
  for (const [id, on] of now) {
    const row = was.get(id), messageId = String(row?.clickup_message_id || "").trim();
    if (!row || !messageId || on === !!row.read) continue;
    out.push({ id, messageId, on });
  }
  return out;
}
