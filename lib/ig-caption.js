// (2026-11-16) Site › Instagram: the company's caption format, the one rule the composer's preview and the server share.
// Pure (no imports), so it runs in the browser and in tests. The real captions it reproduces, from @defiedmgmt:
//   ‘snooze !’ by @zaybeezy @prodgavin            a single: the title in curly quotes, "by" every main artist,
//                                                  a blank line, then the one credit line
//   Produced by @prodgavin                         "Produced by" when only Defied producers (or one person) made it,
//                                                  else "Co-Produced by" (the default); producers space-separated
//   ‘Death to Everybody’ by @1600luhe__           an album: one "Track N - ‘Title’" line per track Defied worked on,
//   Track 9 - ‘Feet On Land’                       each followed by its own credit line; when every listed track has
//   Co-Produced by @stackkie                       the same producers and the same credit, the tracks first and ONE
//                                                  credit line after a blank line
//   Track 16 - ‘Bad Habit ft @bfuxkin6’            a feature on a track is "ft @handle" inside the quotes
//   ‘Mothers Chosen’ by @ohitzyakk / Out now!      no producer credit at all: "Out now!"

export const TYPES = ["single", "album", "video"];
export const CREDITS = { co: "Co-Produced by", produced: "Produced by" };
export const MAX_COLLABORATORS = 3; // Instagram's own limit per post
export const MAX_TAGS = 20; // Instagram's limit of people tagged on one photo
export const MAX_CAPTION = 2200;

// a handle as Instagram has it: no "@" (one is added back when written), no spaces, a profile link's last part
export function cleanHandle(v) {
  let s = String(v ?? "").trim();
  const m = /instagram\.com\/@?([^/?#\s]+)/i.exec(s);
  if (m) s = m[1];
  return s.replace(/^@+/, "").replace(/\s+/g, "").replace(/\/+$/, "");
}
// Instagram's rule for a username: letters, numbers, periods and underscores, 30 at most
export const validHandle = (h) => /^[A-Za-z0-9._]{1,30}$/.test(String(h ?? ""));

// a title without Spotify's own feature tag ("Bad Habit (feat. bfuxkin6)" -> "Bad Habit"): the caption writes features itself
export const cleanTitle = (t) => String(t ?? "").replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "").replace(/\s+/g, " ").trim();

const quote = (s) => `‘${String(s ?? "").trim()}’`;
// one person as written: @handle, or their name until a handle is filled in (the post itself waits for every handle)
const atOf = (p) => { const h = cleanHandle(typeof p === "string" ? p : p?.handle); return h ? `@${h}` : String(p?.name ?? "").trim(); };
// people space-separated, each once
const listOf = (people) => {
  const seen = new Set(), out = [];
  for (const p of people || []) { const a = atOf(p); const k = a.toLowerCase(); if (a && !seen.has(k)) { seen.add(k); out.push(a); } }
  return out.join(" ");
};
const creditOf = (c) => CREDITS[c] || CREDITS.co;
const sameCredit = (a, b) => creditOf(a.credit) === creditOf(b.credit) && listOf(a.producers).toLowerCase().split(" ").sort().join(" ") === listOf(b.producers).toLowerCase().split(" ").sort().join(" ");

// draft: { type: "single" | "album" | "video", title, artists: [{ name, handle }],
//          producers: [{ name, handle }], credit: "co" | "produced",                                    (single, video)
//          tracks: [{ n, title, features: [{ name, handle }], producers: [{ name, handle }], credit }] } (album: the ticked ones)
export function captionOf(draft) {
  const d = draft || {};
  const by = listOf(d.artists);
  const head = by ? `${quote(d.title)} by ${by}` : quote(d.title);
  let body;
  if (d.type === "album") {
    const tracks = (d.tracks || []).filter(Boolean);
    const line = (t) => { const ft = listOf(t.features); return `Track ${t.n} - ${quote(`${String(t.title ?? "").trim()}${ft ? ` ft ${ft}` : ""}`)}`; };
    const credited = (t) => (listOf(t.producers) ? `${creditOf(t.credit)} ${listOf(t.producers)}` : "");
    if (!tracks.length) body = "Out now!";
    else if (tracks.length > 1 && listOf(tracks[0].producers) && tracks.every((t) => sameCredit(t, tracks[0]))) body = `${tracks.map(line).join("\n")}\n\n${credited(tracks[0])}`;
    else body = tracks.map((t) => [line(t), credited(t)].filter(Boolean).join("\n")).join("\n");
  } else {
    const prods = listOf(d.producers);
    body = prods ? `${creditOf(d.credit)} ${prods}` : "Out now!";
  }
  return `${head}\n\n${body}`.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
}

// Everyone on the post, in the order the owner's playbook asks for ("ALWAYS tag AND collaborate with all artists and
// producers"): the artists first (the main ones, then the features of the ticked tracks), then the producers. Each person
// once (by handle, else by name). Each comes back as given, with role "artist" | "producer".
export function peopleOf(draft) {
  const d = draft || {};
  const out = [], seen = new Set();
  const add = (p, role) => {
    if (!p) return;
    const h = cleanHandle(p.handle).toLowerCase();
    const k = h ? `@${h}` : `${role}:${String(p.key ?? p.name ?? "").trim().toLowerCase()}`;
    if (seen.has(k) || k.endsWith(":")) return;
    seen.add(k); out.push({ ...p, handle: cleanHandle(p.handle), role });
  };
  for (const a of d.artists || []) add(a, "artist");
  const tracks = d.type === "album" ? (d.tracks || []).filter(Boolean) : [];
  for (const t of tracks) for (const f of t.features || []) add(f, "artist");
  for (const p of d.type === "album" ? tracks.flatMap((t) => t.producers || []) : d.producers || []) add(p, "producer");
  return out;
}

// where each tagged person sits on the photo: spread over a grid inside the middle of the image, never on its edge.
// n people -> [{ x, y }] (0..1, two decimals)
export function tagSpots(n) {
  const count = Math.max(0, Math.min(MAX_TAGS, Number(n) || 0));
  if (!count) return [];
  const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
  const r2 = (v) => Math.round(v * 100) / 100;
  return Array.from({ length: count }, (_, i) => ({ x: r2((i % cols + 1) / (cols + 1)), y: r2((Math.floor(i / cols) + 1) / (rows + 1)) }));
}
