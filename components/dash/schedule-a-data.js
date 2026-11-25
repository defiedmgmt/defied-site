// Site › Sync's "Sync Schedule A now" (lib/sync-checks.js scheduleA check, pages/api/schedule-a.js): the press, with no screen of its own (a leaf: it imports
// nothing, so Site › Sync and To do load no more than they did). One POST; the answer as the note under the Sync list, then the checks are read again.
const post = () => fetch("/api/schedule-a", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: "{}" });

const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
// the answer in words: "Schedule A synced: 172 songs from 9 producers. 1 song is only on the sheet (not on the site yet). 2 artist rows removed. 3 added. EMPIRE copy: 40 songs over 1M streams
// · 9 left out (uncleared sample)." (the EMPIRE part is only in a Founder's answer: pages/api/schedule-a.js withoutEmpire)
export function scheduleAWords(out) {
  if (!out?.ok) return out?.late ? "Schedule A is still being written. Check again in a minute." : `Schedule A wasn't run${out?.skipped ? ` (${out.skipped})` : ""}.`;
  const sum = out.summary || {};
  return [
    `Schedule A synced: ${n(out.rows || 0, "song", "songs")} from ${n(out.producers || 0, "producer", "producers")}.`,
    out.onlyOnSheet ? `${n(out.onlyOnSheet, "song is", "songs are")} only on the sheet (not on the site yet).` : "",
    sum.removedArtistRows ? `${n(sum.removedArtistRows, "artist row", "artist rows")} removed.` : "",
    sum.added ? `${sum.added} added.` : "",
    sum.removed ? `${n(sum.removed, "row", "rows")} no longer on the site taken off.` : "",
    sum.notesStashed ? `${n(sum.notesStashed, "note", "notes")} of ${sum.notesStashed === 1 ? "a row" : "rows"} that left the table ${sum.notesStashed === 1 ? "is" : "are"} kept, in case ${sum.notesStashed === 1 ? "it comes" : "they come"} back.` : "",
    sum.notesRestored ? `${n(sum.notesRestored, "kept note", "kept notes")} came back with ${sum.notesRestored === 1 ? "its row" : "their rows"}.` : "",
    out.changed === false ? "Nothing had changed." : "",
    // (2026-11-24) the EMPIRE copy, written after it: how many songs it has, or why it wasn't written (the sync itself is done either way)
    out.empire?.error ? `The EMPIRE copy wasn't written: ${String(out.empire.error).replace(/^The EMPIRE copy wasn't written: /, "")}` : out.empire?.ok ? `EMPIRE copy: ${n(out.empire.songs || 0, "song", "songs")} over 1M streams${out.empire.leftOut > 0 ? ` · ${out.empire.leftOut} left out (uncleared sample)` : ""}.` : "",
  ].filter(Boolean).join(" ");
}

// -> { ok, text } or { warn: true, text }; never throws. then(sync.load(true)) is the caller's
export async function syncScheduleANow() {
  try {
    const r = await post();
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return { warn: true, text: out?.error || "That didn't go through. Try again in a minute." };
    return { warn: false, text: scheduleAWords(out) };
  } catch {
    return { warn: true, text: "That didn't go through. Try again in a minute." };
  }
}
