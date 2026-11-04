// The dashboard's own to-dos, area by area, worked out on the server for the self-updating ClickUp
// tasks (lib/clickup-tasks.js planAreaTask): the cron runs with nobody signed in, and an action
// (a split confirmed, a song marked as added, an A&R write) brings its area's task up to date right
// after. Same rules and words as todoItems/dashTasks in components/App.jsx; keep the two in step.
// Money's to-dos are the "Log new payments" task (lib/money.js), not one of these.
import { sql } from "./db";
import { lumState } from "./luminate";
import { evenSplit } from "./splits";
import { likelyDuplicates } from "./duplicates";
import { songGaps } from "./sheet-facts";
import { readSheetFacts } from "./sheet-facts-store";
import { shareFixes } from "./split-fixes";
import { syncTasksNow, lumGroupsOf } from "./sync-tasks";
import { nyToday } from "./ar";
import { runAreaTask, writesOn } from "./clickup-tasks";

const s = (n, one, many) => (n === 1 ? one : many);
const total = (splits) => (splits || []).reduce((a, x) => a + Number(x.percent || 0), 0);
const camel = (p) => ({ id: p.id, clientId: p.client_id, song: p.song, artist: p.artist, releaseDate: p.release_date, link: p.link,
  luminateId: p.luminate_id, streams: Number(p.streams) || 0, splits: p.splits || [] });

// Publishing: splits to confirm (an even default, or one that needs review), possible duplicates, songs
// the sheet or the site is missing something for, and clients whose sheet tab can't be found. Pure.
export function publishingItems({ placements, clients, facts = { songs: {}, clients: {} }, lum = {} }) {
  const ps = placements.map((p) => (p.clientId ? p : camel(p)));
  const isrcOf = (id) => lum.tracking?.[id]?.isrc || "";
  const dupes = likelyDuplicates(ps, { facts, isrcOf, dismissed: lum.notDuplicates || [] });
  const held = new Set(dupes.flatMap((x) => [x.keep.id, x.drop.id]));
  // (r7) a share with one clear answer is its own line: no split here while the sheet has 100%, or a blank on the sheet
  const fix = shareFixes({ placements: ps, clients, facts });
  const fixSite = new Set(fix.site.map((x) => x.p.id)), fixSheet = new Set(fix.sheet.map((x) => x.p.id));
  let even = 0, look = 0;
  for (const p of ps) {
    if (held.has(p.id) || fixSite.has(p.id) || total(p.splits) === 100) continue;
    if (evenSplit(p.splits).status === "assumed") even++; else look++;
  }
  // songs to update: the gaps that aren't a split (Splits to confirm has those)
  const groups = lumGroupsOf(lum, placements.map((p) => ({ id: p.id, song: p.song, artist: p.artist, luminate_id: p.luminateId ?? p.luminate_id ?? "" })));
  const inLum = new Map(groups.flatMap((g) => g.ids.map((id) => [id, !!(g.luminateId || g.status === "skipped")])));
  let update = 0;
  for (const p of ps) {
    if (held.has(p.id)) continue;
    const split = total(p.splits) === 100 ? "ok" : evenSplit(p.splits).status;
    const gaps = songGaps({ p, fact: facts.songs?.[p.id], tabRead: facts.clients?.[p.clientId] != null, split, inLuminate: inLum.get(p.id) ?? !!p.luminateId });
    if (gaps.some((g) => ["share", "sheet", "date", "link", "lum"].includes(g.k) && !(g.k === "share" && fixSheet.has(p.id)))) update++;
  }
  const withSongs = new Set(ps.map((p) => p.clientId));
  const noTab = (lum.missingTabs || []).filter((n) => { const c = clients.find((x) => x.name === n || (x.sheet_tab_name || x.sheetTabName || "").trim() === n); return !c || withSongs.has(c.id); });
  const nSite = fix.site.length, nSheet = fix.sheet.length;
  return [
    nSite && { id: "share-site", label: `Use the sheet's 100% split for ${nSite} ${s(nSite, "song", "songs")} with no split on the site` },
    nSheet && { id: "share-sheet", label: `Fill in ${nSheet} blank writer ${s(nSheet, "share", "shares")} on the sheet (100% on the site)` },
    even && { id: "splits-even", label: `Confirm ${even} even ${s(even, "split", "splits")}` },
    look && { id: "splits-look", label: `Review ${look} ${s(look, "split that doesn't", "splits that don't")} add up` },
    dupes.length && { id: "dupes", label: `Review ${dupes.length} possible duplicate ${s(dupes.length, "song", "songs")}` },
    update && { id: "update", label: `Update ${update} ${s(update, "song", "songs")} missing something on the sheet or the site` },
    ...noTab.map((n) => ({ id: `tab:${n}`, label: `Set ${n}'s sheet tab: the pub sheet has no tab by that name` })),
  ].filter(Boolean);
}

// Luminate: the weekly sync's lines (exports to drop, songs to add, matches, missing, ISRCs) and the
// songs taken off the site that still use a slot
export async function luminateItems({ lum, placements } = {}) {
  const lines = await syncTasksNow(Date.now(), { lum, placements });
  const gone = (lum?.notOursLeft || []).map((r) => ({ id: `gone:${r.luminateId}`, label: `Take "${r.name}" out of ${r.portfolioName} in Luminate` }));
  return [...lines.filter((x) => x.id !== "arLuminate").map(({ id, label }) => ({ id, label })), ...gone];
}

// A&R: follow-ups due today or late (each person), and who to add to the Luminate A&R lists
export async function arItems({ lum, placements } = {}) {
  const today = nyToday();
  const due = await sql`SELECT id, name FROM ar_prospects
    WHERE follow_up_on <= ${today}::date AND removed_at IS NULL AND merged_into IS NULL AND client_id IS NULL
      AND COALESCE(sheet_seen->>'O', '') NOT IN ('Signed', 'Passed') ORDER BY follow_up_on, name`;
  const lines = await syncTasksNow(Date.now(), { lum, placements });
  return [...due.map((p) => ({ id: `follow:${p.id}`, label: `Follow up with ${p.name}` })), ...lines.filter((x) => x.id === "arLuminate").map(({ id, label }) => ({ id, label }))];
}

export const AREAS = ["luminate", "publishing", "ar"];
// Every area's items from one read of the database (the cron, the Dashboard's check, the Sync view)
export async function areaItemsNow(areas = AREAS) {
  const [lum, placements, clients, facts] = await Promise.all([lumState(), sql`SELECT * FROM placements`, sql`SELECT id, name, sheet_tab_name FROM clients`, readSheetFacts()]);
  const out = {};
  for (const a of areas) {
    try {
      out[a] = a === "publishing" ? publishingItems({ placements, clients, facts, lum })
        : a === "luminate" ? await luminateItems({ lum, placements }) : await arItems({ lum, placements });
    } catch (err) { console.error(`area items ${a}:`, err); out[a] = null; }
  }
  return out;
}

// Bring these areas' ClickUp tasks up to date: the cron and the Dashboard's check, and right after the
// action that changed them. Writes nothing unless CLICKUP_TASK_WRITES is "on"; never throws.
export async function refreshAreaTasks(areas = AREAS) {
  if (!writesOn()) return { skipped: "writes off" };
  try {
    const items = await areaItemsNow(areas);
    const out = {};
    for (const a of areas) out[a] = items[a] ? await runAreaTask(a, items[a]) : { skipped: "couldn't work out the to-dos" };
    return out;
  } catch (err) {
    console.error("area tasks failed:", err);
    return { error: "Couldn't work out the to-dos" };
  }
}

// Right after an action (a split confirmed, a song marked as added, an A&R write): its areas' tasks
// follow at once. A slow ClickUp never holds the action's answer up by more than 4 seconds.
export async function afterAction(areas) {
  if (!writesOn()) return;
  await Promise.race([refreshAreaTasks(areas), new Promise((r) => setTimeout(r, 4000))]);
}
