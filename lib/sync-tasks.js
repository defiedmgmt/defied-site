// The Dashboard's Luminate syncing jobs (exports to drop, songs to add, matches, missing songs,
// ISRCs), worked out on the server for the weekly ClickUp task: the cron runs with nobody signed in.
// Same rules and words as lumGroups/dashTasks in components/App.jsx; keep the two in step.
import { sql } from "./db";
import { lumState } from "./luminate";
import { normalizeTitle } from "./sheets";

const DAY = 86400000;
const s = (n, one, many) => (n === 1 ? one : many);

export async function syncTasksNow(now = Date.now()) {
  const [lum, placements] = await Promise.all([lumState(), sql`SELECT id, song, artist, luminate_id FROM placements`]);
  const t = lum.tracking || {}, inPortfolio = lum.inPortfolio || {};
  const ports = (lum.portfolios || []).filter((p) => p.kind === "roster");
  const hasExports = ports.some((p) => p.exportedAt);
  const missed = (g) => {
    const p = ports.find((x) => x.id === g.portfolioId);
    if (!p) return true;
    const made = p.exportedAt || p.uploadedAt;
    return !!(made && g.addedAt && new Date(g.addedAt) < new Date(made));
  };
  const title = (p) => `${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`;
  const idsOf = new Map();
  for (const p of placements) if (p.luminate_id) idsOf.set(title(p), new Set([...(idsOf.get(title(p)) || []), p.luminate_id]));
  const byKey = new Map();
  for (const p of placements) {
    const only = !p.luminate_id && idsOf.get(title(p))?.size === 1 ? [...idsOf.get(title(p))][0] : null;
    const key = p.luminate_id || only ? `lum:${p.luminate_id || only}` : `t:${title(p)}`;
    const g = byKey.get(key) || { ids: [], isrc: "", checked: false, portfolioId: null, addedAt: null, skip: true, luminateId: "" };
    const tr = t[p.id] || {};
    g.ids.push(p.id);
    g.isrc ||= tr.isrc || "";
    g.checked ||= !!tr.isrcCheckedAt;
    g.portfolioId ||= tr.portfolioId || null;
    g.addedAt ||= tr.addedAt || null;
    g.skip &&= !!tr.skip;
    g.luminateId ||= p.luminate_id || only || "";
    byKey.set(key, g);
  }
  const offered = new Set((lum.unlinked || []).flatMap((u) => u.suggestions));
  const groups = [...byKey.values()].map((g) => {
    const inP = g.luminateId ? inPortfolio[g.luminateId] || null : null;
    const status = g.skip ? "skipped" : inP || (g.luminateId && !hasExports) ? "tracked"
      : !g.luminateId && g.ids.some((id) => offered.has(id)) ? "match"
      : g.portfolioId ? (missed(g) ? "missing" : "waiting") : g.luminateId ? "unplaced" : "toAdd";
    return { ...g, status };
  });
  const n = (st) => groups.filter((g) => g.status === st).length;
  const toAdd = n("toAdd"), unplaced = n("unplaced"), missing = n("missing");
  const noIsrc = groups.filter((g) => (g.status === "toAdd" || g.status === "unplaced") && !g.isrc && g.checked).length;
  const up = lum.lastUpload, at = up?.at ? new Date(up.at).getTime() : null, made = up?.numbersFrom ? new Date(up.numbersFrom).getTime() : null;
  const byNumbers = made !== null && (at === null || made < at);
  const stale = byNumbers ? (now - made) / DAY : at !== null ? (now - at) / DAY : null;
  const unlinked = (lum.unlinked || []).length;
  return [
    stale === null ? { id: "stale", label: "Drop the first Luminate exports", count: 1 }
      : stale > 8 && { id: "stale", label: `Drop this week's Luminate exports (the newest numbers are ${Math.floor(stale)} days old)`, count: 1 },
    toAdd && { id: "add", label: `Add ${toAdd} ${s(toAdd, "song", "songs")} to a Luminate portfolio`, count: toAdd },
    unplaced && { id: "unplaced", label: `Put ${unplaced} ${s(unplaced, "song", "songs")} with a Luminate id into a portfolio`, count: unplaced },
    unlinked && { id: "unlinked", label: `Match ${unlinked} new Luminate ${s(unlinked, "song", "songs")} to a song here`, count: unlinked },
    missing && { id: "missing", label: `Check ${missing} ${s(missing, "song", "songs")} marked as added but not in the latest export`, count: missing },
    noIsrc && { id: "isrc", label: `Type in ${noIsrc} ${s(noIsrc, "ISRC", "ISRCs")} that couldn't be found automatically`, count: noIsrc },
  ].filter(Boolean);
}
