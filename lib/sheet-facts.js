// What the pub sheet itself says about a client's songs (build G): the row each song is on, the Writer
// Share that row holds (a blank cell stays blank: it earns nothing) and the tab's Net Streams, worked out
// the way the sheet does (each row's gross × share, summed: MASTER's writer table). Pure, so the browser
// and the tests can use it too; the sheet pull stores what it returns (lib/sheet-facts-store.js).

// the same as normalizeTitle in lib/sheets.js (that file loads googleapis, so it can't come in here). (2026-11-13) with
// its "(feat. X)" strip too: without it a hand-typed "Song (feat. X)" row synced its streams to the site's "Song" yet
// To do called the song "Not on the pub sheet"
const titleKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/\s+(feat|ft|featuring)\s+.*$/, "").trim();
const lumOf = (p) => p.luminateId ?? p.luminate_id ?? "";

// a song's row on its client's tab, in the order the sheet pull matches them (pullAndMergeSheetData,
// lib/site-sync.js): its own Site Sync ID, then its Luminate ID, then a row with its title that no live
// song has claimed. `live` is every song id on the site.
export function sheetRowFor(p, rows, live) {
  const lum = lumOf(p);
  return rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id)
    || (lum && rows.find((r) => r.luminateId && r.luminateId === lum))
    || rows.find((r) => (!r.syncId || !live.has(r.syncId.split(":")[0])) && titleKey(r.song) === titleKey(p.song))
    || null;
}

// the tab's Net Streams as the writer table shows it: a whole number
export function sheetNet(rows) {
  return Math.round(rows.reduce((sum, r) => sum + (Number(r.grossStreams) || 0) * ((Number(r.writerShare) || 0) / 100), 0));
}

// one fact per song of this client that has a row: { placementId, row, share (null = blank), net }
export function sheetFactsFor(songs, rows, live) {
  const out = [];
  for (const p of songs) {
    const r = sheetRowFor(p, rows, live);
    if (!r) continue;
    const blank = r.shareBlank ?? !(Number(r.writerShare) > 0);
    out.push({ placementId: p.id, row: r.row, share: blank ? null : Number(r.writerShare) || 0, net: (Number(r.grossStreams) || 0) * ((Number(r.writerShare) || 0) / 100) });
  }
  return out;
}

// A client's net streams: the sheet's figure once a pull has read their tab, else the app's own
// estimate (each song's streams × the client's own split %), marked so the page can say "estimate".
export function netStreamsOf(sheetNetValue, estimate) {
  return sheetNetValue != null && Number.isFinite(Number(sheetNetValue))
    ? { value: Number(sheetNetValue), fromSheet: true }
    : { value: Math.round(Number(estimate) || 0), fromSheet: false };
}

// What a song is missing, in the order the editor's fields come (the first one is where Edit opens).
// `fact` is its sheet fact (undefined: no row), `tabRead` whether the client's tab has been read,
// `split` the even-split rule's status ("ok" | "assumed" | "look"). (List B #3: "Not in Luminate" is gone
// with Luminate; a song with no Spotify link is the Numbers' own To do.)
export const SONG_GAPS = [
  ["share", "No writer share in the sheet", "splits"],
  ["sheet", "Not on the pub sheet", "splits"],
  ["confirm", "Split to confirm", "splits"],
  ["look", "Split needs review", "splits"],
  ["date", "No release date", "releaseDate"],
  ["link", "No link", "link"],
];
export function songGaps({ p, fact, tabRead, split }) {
  const has = {
    share: !!fact && fact.share == null,
    sheet: tabRead && !fact,
    confirm: split === "assumed",
    look: split === "look",
    date: !p.releaseDate,
    link: !p.link,
  };
  return SONG_GAPS.filter(([k]) => has[k]).map(([k, label, field]) => ({ k, label, field }));
}
