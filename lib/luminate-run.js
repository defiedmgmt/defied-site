// What happens once new Luminate exports are in: STREAM DATA is rebuilt,
// newly added songs are linked, every client's numbers are pulled onto the
// site, and ClickUp hears how it went. Shared by the dashboard upload, its
// "Update the sheet again" button, and (later) the Mac helper.
import { sql } from "./db";
import { rebuildStreamData, autoLink, writeLuminateIds, growthFor, setState } from "./luminate";
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

export async function afterExports({ taken = [], by = "", notify = true } = {}) {
  const out = { streamData: null, links: [], linkSheet: null, sync: null, error: null };
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
  const summary = {
    at: new Date().toISOString(), by,
    files: taken.map((t) => ({ portfolio: t.portfolioName || t.portfolioId, songs: t.songs })),
    linked: out.links.filter((l) => !l.copied).length, copied: out.links.filter((l) => l.copied).map((l) => l.song), created: out.sync?.created || 0, error: out.error,
    weekTotal: gainers?.weekTotal ?? null, gainers: gainers?.list || [],
  };
  if (!out.error) await setState("lastUpload", summary);
  if (notify) {
    const lines = out.error
      ? [`**Luminate update didn't finish**: ${out.error}`, "The new exports are saved. Open the dashboard's Luminate page and press **Update the sheet again**."]
      : [
          `**Luminate update**: ${taken.length ? taken.map((t) => `${t.portfolioName || t.portfolioId} (${t.songs} songs)`).join(", ") : "sheet refreshed"}`,
          summary.weekTotal != null && summary.gainers.length ? `This week: **+${short(summary.weekTotal)}** streams across ${gainers.songs} songs` : null,
          summary.gainers.length ? `Top gainers: ${summary.gainers.slice(0, 3).map((g) => `${g.song} (+${short(g.week)})`).join(", ")}` : null,
          out.links.some((l) => !l.copied) ? `Linked ${out.links.filter((l) => !l.copied).length} new song${out.links.filter((l) => !l.copied).length === 1 ? "" : "s"} automatically.` : null,
          // a co-writer's copy that was missing its id: their share in the sheet now counts, so name them
          out.links.some((l) => l.copied) ? `Gave ${out.links.filter((l) => l.copied).length} co-writer cop${out.links.filter((l) => l.copied).length === 1 ? "y" : "ies"} the Luminate id their song already had: ${[...new Set(out.links.filter((l) => l.copied).map((l) => l.song))].slice(0, 5).join(", ")}` : null,
        ].filter(Boolean);
    lines.push(`[Open dashboard](${DASHBOARD})`);
    await notifyClickUp(lines.join("\n"));
  }
  return { ...out, summary };
}
