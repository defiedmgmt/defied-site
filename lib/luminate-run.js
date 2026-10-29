// What happens once new Luminate exports are in: STREAM DATA is rebuilt,
// newly added songs are linked, every client's numbers are pulled onto the
// site, and ClickUp hears how it went. Shared by the dashboard upload, its
// "Update the sheet again" button, and (later) the Mac helper.
import { sql } from "./db";
import { rebuildStreamData, autoLink, writeLuminateIds, growthFor, getState, setState, slotsText, clientNumbers } from "./luminate";
import { syncSiteFromSheet } from "./site-sync";
import { notifyClickUp } from "./clickup";
import { normalizeTitle } from "./sheets";

const DASHBOARD = "https://www.defiedmgmt.com/dashboard";
const short = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

// the week's biggest movers among songs on the site (one entry per Luminate song, however many
// clients' pages it sits on)
export async function topGainers(limit = 5) {
  const rows = await sql`SELECT p.luminate_id, p.song, p.artist, c.name AS client FROM placements p JOIN clients c ON c.id = p.client_id WHERE p.luminate_id <> ''`;
  const growth = await growthFor(rows.map((r) => r.luminate_id));
  const seen = new Map();
  for (const r of rows) {
    const g = growth[r.luminate_id];
    if (!g || g.week == null) continue;
    // one entry per song, even one linked to two Luminate ids on two clients' pages
    const key = `${normalizeTitle(r.song)}|${normalizeTitle(r.artist)}`;
    const cur = seen.get(key);
    if (cur) { if (!cur.clients.includes(r.client)) cur.clients.push(r.client); if (g.week > cur.week) Object.assign(cur, { week: g.week, weekPct: g.weekPct, latest: g.latest }); continue; }
    seen.set(key, { song: r.song, artist: r.artist, clients: [r.client], week: g.week, weekPct: g.weekPct, latest: g.latest });
  }
  const all = [...seen.values()];
  return { list: all.sort((a, b) => b.week - a.week).slice(0, limit), weekTotal: all.reduce((a, x) => a + x.week, 0), songs: all.length };
}

// One line per A&R portfolio kept from a drop (its newest file): added to the drop's one ClickUp
// message. They don't touch STREAM DATA or anyone's numbers, so they don't count as an update.
export function arLines(kept) {
  const list = [...new Map(kept.map((t) => [t.portfolioId, t])).values()];
  if (!list.length) return [];
  return [`**A&R exports kept for the A&R tab**: ${list.map((t) => `${t.portfolioName || t.portfolioId} (${slotsText(t)})`).join(", ")}`];
}

// A&R files kept from a drop start their own clock (arLastUpload), apart from the clients' lastUpload
export async function markArKept(kept, by = "") {
  const list = [...new Map(kept.map((t) => [t.portfolioId, t])).values()];
  if (!list.length) return null;
  const summary = { at: new Date().toISOString(), by, files: list.map((t) => ({ portfolio: t.portfolioName || t.portfolioId, area: t.area, artists: t.artists || 0, songs: t.songs || 0, releases: t.releases || 0 })) };
  await setState("arLastUpload", summary);
  return summary;
}

// a drop with only A&R files in it: just say they were kept
export async function notifyArKept(kept) {
  return notifyClickUp([...arLines(kept), `[Open dashboard](${DASHBOARD})`].join("\n"));
}

// taken = the clients' files a drop took in (none for "Update the sheet again" / "Refresh numbers").
// lastUpload is only ever about the clients' numbers, so the stale alert and the Dashboard's tasks
// stay honest. A refresh brings no new numbers, so ClickUp only hears of one that did something:
// linked or added songs, finished an update that had failed, or failed (once, not on every retry).
export async function afterExports({ taken: all = [], by = "", notify = true, markUpload = true, extraLines = [] } = {}) {
  // one line per portfolio (its newest file); older ones in the same drop were growth history
  const taken = [...new Map(all.map((t) => [t.portfolioId, t])).values()];
  const out = { streamData: null, links: [], linkSheet: null, sync: null, error: null };
  const failedBefore = await getState("updateFailed").catch(() => null);
  try {
    out.streamData = await rebuildStreamData();
    out.links = await autoLink();
    out.linkSheet = await writeLuminateIds(out.links);
    out.sync = await syncSiteFromSheet();
  } catch (err) {
    console.error("Luminate update failed:", err);
    out.error = err.message || "The update stopped partway.";
  }
  const gainers = out.error ? null : await topGainers().catch(() => null);
  // "Update the sheet again" brings no new numbers: they're as old as the newest clients' export
  // taken in (a drop whose update failed counts once this finishes it), so a refresh never hides
  // that they're getting stale. With no export at all there's no update to record.
  const prev = taken.length ? null : await getState("lastUpload");
  const nums = await clientNumbers();
  const at = taken.length ? new Date().toISOString() : nums.uploadedAt;
  const summary = {
    // numbersFrom: the day Luminate made the oldest portfolio's newest export (the stale clocks go by it)
    at, numbersFrom: nums.numbersFrom, numbersPortfolio: nums.portfolio, numbersPortfolioId: nums.portfolioId, by: prev?.by || by,
    files: taken.length ? taken.map((t) => ({ portfolio: t.portfolioName || t.portfolioId, songs: t.songs, artists: t.artists || 0, releases: t.releases || 0 })) : prev?.files || [],
    linked: out.links.filter((l) => !l.copied).length, copied: out.links.filter((l) => l.copied).map((l) => l.song), created: out.sync?.created || 0, error: out.error,
    weekTotal: gainers?.weekTotal ?? null, gainers: gainers?.list || [],
  };
  if (!out.error && markUpload && summary.at) await setState("lastUpload", summary);
  if (out.error) await setState("updateFailed", { at: new Date().toISOString(), error: out.error }).catch(() => {});
  else if (failedBefore) await setState("updateFailed", null);
  const news = taken.length || (out.error ? !failedBefore : out.links.length || out.sync?.created || failedBefore);
  if (notify && news) {
    const lines = out.error
      ? [`**Luminate update didn't finish**: ${out.error}`, "The new exports are saved. Open the dashboard's Luminate page and press **Update the sheet again**."]
      : [
          `**Luminate update**: ${taken.length ? taken.map((t) => `${t.portfolioName || t.portfolioId} (${slotsText(t)})`).join(", ") : "sheet refreshed"}`,
          summary.weekTotal != null && summary.gainers.length ? `This week: **+${short(summary.weekTotal)}** streams across ${gainers.songs} songs` : null,
          summary.gainers.length ? `Top gainers: ${summary.gainers.slice(0, 3).map((g) => `${g.song} (+${short(g.week)})`).join(", ")}` : null,
          out.links.some((l) => !l.copied) ? `Linked ${out.links.filter((l) => !l.copied).length} new song${out.links.filter((l) => !l.copied).length === 1 ? "" : "s"} automatically.` : null,
          // a co-writer's copy that was missing its id: their share in the sheet now counts, so name them
          out.links.some((l) => l.copied) ? `Gave ${out.links.filter((l) => l.copied).length} co-writer cop${out.links.filter((l) => l.copied).length === 1 ? "y" : "ies"} the Luminate id their song already had: ${[...new Set(out.links.filter((l) => l.copied).map((l) => l.song))].slice(0, 5).join(", ")}` : null,
        ].filter(Boolean);
    lines.push(...extraLines, `[Open dashboard](${DASHBOARD})`);
    await notifyClickUp(lines.join("\n"));
  }
  return { ...out, summary };
}
