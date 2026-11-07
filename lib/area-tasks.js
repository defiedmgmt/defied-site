// The dashboard's own to-dos, area by area, worked out on the server for the self-updating ClickUp
// tasks (lib/clickup-tasks.js planAreaTask): the cron runs with nobody signed in, and an action
// (a split confirmed, an A&R write) brings its area's task up to date right after. Same rows and counts as
// To do's (todoItems in components/dash/todo-data.js, trueUpTodoItems in components/trueup-data.js); keep them in step.
// Money's payments to log are the "Log new payments" task (lib/money.js); Money's other rows are the Money task here.
// To do's website messages aren't in a task: each one is posted to ClickUp's Website Messages channel already.
import { sql } from "./db";
import { songInfoState } from "./song-info";
import { evenSplit } from "./splits";
import { likelyDuplicates, spotifyTrack } from "./duplicates";
import { songGaps } from "./sheet-facts";
import { readSheetFacts } from "./sheet-facts-store";
import { shareFixes } from "./split-fixes";
import { normalizeTitle } from "./sheets";
import { loadSeeds, seedTodo } from "./data/seeds";
import { trueUpState } from "./trueup";
import { pubSheetCheck, infoCheck } from "./sync-checks";
import { moneyState, payerNamer } from "./money";
import { sectionChecks } from "./accounting-section";
import { runAreaTask, writesOn } from "./clickup-tasks";

const s = (n, one, many) => (n === 1 ? one : many);
const total = (splits) => (splits || []).reduce((a, x) => a + Number(x.percent || 0), 0);
const camel = (p) => ({ id: p.id, clientId: p.client_id, song: p.song, artist: p.artist, releaseDate: p.release_date, link: p.link,
  luminateId: p.luminate_id, streams: Number(p.streams) || 0, splits: p.splits || [] });
// a sync check as To do's row: amber only (null = it couldn't be checked, so its line stays as it was)
const syncLine = (c, id) => (c?.ok === false ? { id, n: 1, label: c.text.replace(/\.$/, "") } : c?.ok === true ? null : { id, keep: true });
const monthDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

// To do's "N songs have no ISRC" (songsWithoutIsrc, components/dash/isrc-data.js): one per song, the same Spotify
// link or the same title and artist being one song even when two clients' pages have it
function songsWithoutIsrc(ps, tracking) {
  const has = new Map();
  for (const p of ps) {
    const sp = spotifyTrack(p.link);
    const key = sp ? `t:${sp}` : `n:${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`;
    has.set(key, has.get(key) || !!tracking[p.id]?.isrc);
  }
  return [...has.values()].filter((x) => !x).length;
}

// Publishing (To do's "roster" rows): splits to confirm (an even default, or one that needs review), possible
// duplicates, songs the sheet or the site is missing something for, clients whose sheet tab can't be found, songs
// with no ISRC, the old Luminate songs to find on Spotify, the monthly Luminate update, and the pub sheet sync. Pure.
// info: lib/song-info.js's songInfoState (ISRCs, the pairs that aren't the same song, missing tabs)
// seeds: lib/data/seeds.js seedTodo rows; trueup: lib/trueup.js trueUpState; pubSheet: its sync check (lib/sync-checks.js).
// Each of those three left out (undefined) adds nothing; null = it couldn't be read, so its lines stay as they were.
export function publishingItems({ placements, clients, facts = { songs: {}, clients: {} }, info = {}, seeds, trueup, pubSheet }) {
  const ps = placements.map((p) => (p.clientId ? p : camel(p)));
  const isrcOf = (id) => info.tracking?.[id]?.isrc || "";
  const dupes = likelyDuplicates(ps, { facts, isrcOf, dismissed: info.notDuplicates || [] });
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
  let update = 0;
  for (const p of ps) {
    if (held.has(p.id)) continue;
    const split = total(p.splits) === 100 ? "ok" : evenSplit(p.splits).status;
    const gaps = songGaps({ p, fact: facts.songs?.[p.id], tabRead: facts.clients?.[p.clientId] != null, split });
    if (gaps.some((g) => ["share", "sheet", "date", "link"].includes(g.k) && !(g.k === "share" && fixSheet.has(p.id)))) update++;
  }
  const withSongs = new Set(ps.map((p) => p.clientId));
  const noTab = (info.missingTabs || []).filter((n) => { const c = clients.find((x) => x.name === n || (x.sheet_tab_name || x.sheetTabName || "").trim() === n); return !c || withSongs.has(c.id); });
  const nSite = fix.site.length, nSheet = fix.sheet.length;
  // (r11) only once the song facts are in, as To do does, so the count never says the whole catalog
  const noIsrc = info.tracking ? songsWithoutIsrc(ps, info.tracking) : 0;
  const nSeeds = (seeds || []).filter((r) => r.area === "roster").length;
  const nNew = trueup?.notInReport?.length || 0;
  return [
    // n: the line's count, so a task closed by hand comes back only when one goes up (lib/clickup-tasks.js)
    nSite && { id: "share-site", n: nSite, label: `Use the sheet's 100% split for ${nSite} ${s(nSite, "song", "songs")} with no split on the site` },
    nSheet && { id: "share-sheet", n: nSheet, label: `Fill in ${nSheet} blank writer ${s(nSheet, "share", "shares")} on the sheet (100% on the site)` },
    even && { id: "splits-even", n: even, label: `Confirm ${even} even ${s(even, "split", "splits")}` },
    look && { id: "splits-look", n: look, label: `Review ${look} ${s(look, "split that doesn't", "splits that don't")} add up` },
    dupes.length && { id: "dupes", n: dupes.length, label: `Review ${dupes.length} possible duplicate ${s(dupes.length, "song", "songs")}` },
    update && { id: "update", n: update, label: `Update ${update} ${s(update, "song", "songs")} missing something on the sheet or the site` },
    ...noTab.map((n) => ({ id: `tab:${n}`, label: `Set ${n}'s sheet tab: the pub sheet has no tab by that name` })),
    noIsrc && { id: "isrc", n: noIsrc, label: `Find the ISRC for ${noIsrc} ${s(noIsrc, "song", "songs")}` },
    seeds !== undefined && (seeds === null ? { id: "seeds:roster", keep: true } : nSeeds && { id: "seeds:roster", n: nSeeds, label: `Find ${nSeeds} old Luminate Admin Catalog ${s(nSeeds, "song", "songs")} on Spotify` }),
    // the monthly update is one line per month (a new month's is a new to-do); the schedule's, one per end day
    ...(trueup === undefined ? [] : trueup === null ? [{ id: "trueup", keep: true }] : [
      trueup.due && { id: `trueup:${trueup.month1.slice(0, 7)}`, label: `Monthly Luminate update: drop ${monthName(trueup.month1)}'s report` },
      nNew && { id: "trueup:new", n: nNew, label: `${nNew} roster ${s(nNew, "song", "songs")}: no plays this month, or not added to the Luminate report` },
      trueup.schedule?.remind && { id: `trueup:schedule:${trueup.schedule.ends}`, label: `Luminate's schedule ends on ${monthDay(trueup.schedule.ends)}: copy the report to keep it running` },
    ]),
    pubSheet !== undefined && syncLine(pubSheet, "sync:pubSheet"),
  ].filter(Boolean);
}

// A&R (r10): the Watchlist artists whose same-name Spotify match a person still has to confirm (lib/ar.js arSummary's
// count). r11: Outreach is gone, and with it the "Follow up with …" lines; an A&R task still open with those ticks them.
export async function arItems() {
  const [c] = await sql`SELECT count(*)::int AS n FROM ar_tracked WHERE removed_at IS NULL AND kind = 'artist' AND match = 'name'`;
  const n = c?.n || 0;
  return n ? [{ id: "arConfirm", n, label: n === 1 ? "Confirm 1 Watchlist artist's Spotify match" : `Confirm ${n} Watchlist artists' Spotify matches` }] : [];
}

// Money, besides the payments to log: the Income rows to check (less the ones marked OK) and the INFO tab vs the
// site. null when Stripe or the accounting sheet can't be read: an outage must never look like "nothing to check".
export async function moneyItems() {
  const m = await moneyState();
  if (!m.match || !m.acct?.rows) return null;
  const namer = await payerNamer(m.match);
  const [{ toCheck }, placements, clients] = await Promise.all([sectionChecks({ ...m, namer }),
    sql`SELECT id, client_id, song, streams, revenue, admin_fee, splits FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster FROM clients`]);
  const n = toCheck.length;
  return [
    n && { id: "check", n, label: `Check ${n} ${s(n, "row", "rows")} in the Income tab` },
    syncLine(await infoCheck({ placements, clients }, m), "sync:info"),
  ].filter(Boolean);
}

export const AREAS = ["publishing", "ar", "money"];
// These areas' items, each reading only what it needs (the cron, the Dashboard's check, an action). sheets: false
// (right after an action) leaves the pub sheet unread, so its sync line stays as it was.
export async function areaItemsNow(areas = AREAS, { sheets = true } = {}) {
  const out = {};
  for (const a of areas) {
    try {
      if (a === "publishing") {
        const [info, placements, clients, facts, seeds, trueup] = await Promise.all([songInfoState(), sql`SELECT * FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster FROM clients`, readSheetFacts(),
          loadSeeds().then((rows) => seedTodo(rows, ["roster"])).catch((err) => { console.error("area items: seeds", err); return null; }),
          trueUpState().catch((err) => { console.error("area items: true-up", err); return null; })]);
        const pubSheet = sheets ? await pubSheetCheck({ placements, clients }) : null;
        out[a] = publishingItems({ placements, clients, facts, info, seeds, trueup, pubSheet });
      } else out[a] = a === "ar" ? await arItems() : await moneyItems();
    } catch (err) { console.error(`area items ${a}:`, err); out[a] = null; }
  }
  return out;
}

// Bring these areas' ClickUp tasks up to date: the cron and the Dashboard's check, and right after the
// action that changed them. Writes nothing unless CLICKUP_TASK_WRITES is "on"; never throws.
export async function refreshAreaTasks(areas = AREAS, opts = {}) {
  if (!writesOn()) return { skipped: "writes off" };
  try {
    const items = await areaItemsNow(areas, opts);
    const out = {};
    for (const a of areas) out[a] = items[a] ? await runAreaTask(a, items[a]) : { skipped: "couldn't work out the to-dos" };
    return out;
  } catch (err) {
    console.error("area tasks failed:", err);
    return { error: "Couldn't work out the to-dos" };
  }
}

// Right after an action (a split confirmed, an A&R write): its areas' tasks follow at once, from the
// database only (the pub sheet waits for the next check). A slow ClickUp never holds the action's answer up by
// more than 4 seconds.
export async function afterAction(areas) {
  if (!writesOn()) return;
  await Promise.race([refreshAreaTasks(areas, { sheets: false }), new Promise((r) => setTimeout(r, 4000))]);
}
