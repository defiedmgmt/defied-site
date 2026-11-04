// The Mac helper's side of the site (POST /api/luminate-helper): exports it finds in the owner's
// Downloads come in with a per-device token, go through the drop zone's own checks (a dry run of
// takeExports), and are applied by themselves when those pass. The newest file of each portfolio
// wins, as on the dashboard. A file a person should look at first is held back with its CSV: one that
// covers more than about a week, one the checks refuse (all-time went down), or a new portfolio
// nobody has said is A&R or clients'. Staff apply or discard those on the Luminate page.
// Nothing here writes anything unless LUMINATE_HELPER_TOKEN is set. Server-only.
import crypto from "node:crypto";
import { sql, rowsOrNoneIfNoTable } from "./db";
import { parseExport, takeExports, areasFor, isAR, getState, setState } from "./luminate";
import { afterExports, markArKept, arLines } from "./luminate-run";
import { longPeriodNote } from "./weekly";
import { notifyClickUp } from "./clickup";
import { runLuminateWeek } from "./luminate-week";

export const STATE_KEY = "luminateHelper";
const DASHBOARD = "https://www.defiedmgmt.com/dashboard";
const MIN_TOKEN = 24;
const newId = () => crypto.randomBytes(6).toString("hex");
const short = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

// LUMINATE_HELPER_TOKEN: one token per device, comma-separated, each "name:token" (or a bare token,
// named "Mac"). Read at call time. A token under 24 characters is ignored, so a typo can't open it.
export function helperDevices(env = process.env.LUMINATE_HELPER_TOKEN) {
  return String(env || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(":");
    return i > 0 ? { name: s.slice(0, i).trim() || "Mac", token: s.slice(i + 1).trim() } : { name: "Mac", token: s };
  }).filter((d) => d.token.length >= MIN_TOKEN);
}
export const helperOn = () => helperDevices().length > 0;
// the device an "Authorization: Bearer …" header belongs to, or null (compared in constant time)
export function deviceOf(header) {
  const m = /^Bearer\s+(\S+)$/.exec(String(header || ""));
  if (!m) return null;
  const got = crypto.createHash("sha256").update(m[1]).digest();
  for (const d of helperDevices()) if (crypto.timingSafeEqual(got, crypto.createHash("sha256").update(d.token).digest())) return d.name;
  return null;
}

// What the helper's files would do, from the dry run's results: "apply" (ready), "older" (already
// have it or a newer one: nothing to do), "hold" (a person looks first) or "error". Pure.
export function decide(r) {
  if (r.status === "older") return { decision: "older", reason: r.message || "" };
  if (r.status === "needsArea" || r.needsArea) return { decision: "hold", reason: "A portfolio the dashboard hasn't seen before: say what it holds, then apply it." };
  if (r.status === "blocked") return { decision: "hold", reason: r.message };
  if (r.longWeeks) return { decision: "hold", reason: longPeriodNote(r.longWeeks) };
  if (r.status === "ready") return { decision: "apply", reason: "" };
  return { decision: "hold", reason: r.message || "The checks didn't finish." };
}

const by = (device) => `Mac helper (${device})`;
const status = async (patch) => {
  const cur = (await getState(STATE_KEY).catch(() => null)) || {};
  const next = { ...cur, ...patch };
  await setState(STATE_KEY, next);
  return next;
};
const log = (rows) => (rows.length ? sql.transaction(rows.map((r) => sql`
  INSERT INTO luminate_helper_files (id, device, file_name, portfolio_id, exported_at, status, reason, csv)
  VALUES (${newId()}, ${r.device}, ${String(r.fileName || "").slice(0, 300)}, ${r.portfolioId || null}, ${r.exportedAt || null}, ${r.status}, ${String(r.reason || "").slice(0, 1000)}, ${r.csv ?? null})
`)) : null);

// The helper checking in (GET with its token, every half hour or so): the dashboard's status line
// reads lastSeen. Returns what the helper may want to show in its own log.
export async function helperPing(device, { version = "" } = {}) {
  await status({ lastSeen: new Date().toISOString(), device, version: String(version).slice(0, 40) });
  return { ok: true, device };
}

// One upload from the helper: files = [{ name, text }]. Returns { results: [{ fileName, status, reason }],
// applied, held, run? }. status: applied | kept (an A&R list's file) | older | held | error.
export async function helperUpload(files, { device = "Mac", version = "", now = new Date() } = {}) {
  const who = by(device);
  const results = [], rows = [], parsed = [];
  for (const f of files) {
    const p = parseExport(String(f?.name || ""), String(f?.text || ""));
    if (p.error) { results.push({ fileName: f?.name || "", status: "error", reason: p.error }); rows.push({ device, fileName: f?.name, status: "error", reason: p.error }); continue; }
    parsed.push({ ...p, text: String(f.text) });
  }
  // the drop zone's checks, writing nothing: what each file would do
  const areas = await areasFor(parsed);
  const go = [];
  for (const p of parsed) {
    const a = areas.get(p.portfolioId);
    // a portfolio never seen before waits for a person, even one that looks like the clients'
    if (!a.area || a.unknown) { const reason = decide({ status: "needsArea" }).reason; results.push({ fileName: p.fileName, portfolioId: p.portfolioId, status: "held", reason }); rows.push({ device, ...p, status: "held", reason, csv: p.text }); continue; }
    go.push({ ...p, area: a.area, portfolioName: a.name });
  }
  const dry = go.length ? await takeExports(go, { by: who, dryRun: true }) : [];
  const apply = [];
  for (const r of dry) {
    const p = go.find((x) => x.fileName === r.fileName);
    const d = decide(r);
    if (d.decision === "apply") { apply.push(p); continue; }
    const st = d.decision === "older" ? "older" : "held";
    results.push({ fileName: r.fileName, portfolioId: r.portfolioId, portfolioName: r.portfolioName, status: st, reason: d.reason });
    rows.push({ device, ...p, status: st, reason: d.reason, csv: st === "held" ? p.text : null });
  }
  let run = null, taken = [], kept = [];
  if (apply.length) {
    const done = await takeExports(apply, { by: who });
    taken = done.filter((r) => r.status === "taken" && !isAR(r.area));
    kept = done.filter((r) => r.status === "taken" && isAR(r.area));
    for (const r of done) {
      const p = apply.find((x) => x.fileName === r.fileName);
      // (taken in the dry run's moment; anything else here means another drop got in between)
      const st = r.status === "taken" ? (isAR(r.area) ? "kept" : "applied") : r.status === "older" ? "older" : "held";
      const reason = st === "held" ? r.message || "" : "";
      results.push({ fileName: r.fileName, portfolioId: r.portfolioId, portfolioName: r.portfolioName, status: st, reason, notes: r.notes || [] });
      rows.push({ device, ...p, status: st, reason, csv: st === "held" ? p.text : null });
    }
    if (kept.length) await markArKept(kept, who);
    // the clients' numbers: STREAM DATA, links and the site, as a drop does, with this one line to ClickUp instead
    if (taken.length) run = await afterExports({ taken, by: who, notify: false });
  }
  await log(rows);
  const held = results.filter((r) => r.status === "held");
  const line = alertLine({ taken, kept, held, run });
  if (line) await notifyClickUp(line);
  await status({ lastSeen: now.toISOString(), device, ...(version && { version: String(version).slice(0, 40) }), lastUpload: {
    at: now.toISOString(), applied: taken.length + kept.length, held: held.length, older: results.filter((r) => r.status === "older").length,
    errors: results.filter((r) => r.status === "error").length, error: run?.error || null,
  } });
  if (taken.length || kept.length) await runLuminateWeek({ now });
  return { results, applied: taken.length + kept.length, held: held.length, updated: !!run && !run.error, error: run?.error || undefined, summary: run?.summary };
}

// The one ClickUp line for an upload: what was applied (with the week's gain when the clients' numbers
// came in) and what waits for a person, or what went wrong. null when nothing happened (only older files).
export function alertLine({ taken = [], kept = [], held = [], run = null }) {
  const names = (list) => [...new Map(list.map((t) => [t.portfolioId, t.portfolioName || t.portfolioId])).values()].join(", ");
  const parts = [];
  if (run?.error) parts.push(`**Mac helper**: ${names([...taken, ...kept])} came in, but the sheet didn't update (${run.error}). Press **Update the sheet again** on the Luminate page.`);
  else if (taken.length || kept.length) {
    const s = run?.summary;
    const gain = s?.weekTotal != null && s.gainers?.length ? ` · +${short(s.weekTotal)} streams this week` : "";
    const top = s?.gainers?.length ? ` · top: ${s.gainers.slice(0, 2).map((g) => `${g.song} (+${short(g.week)})`).join(", ")}` : "";
    parts.push(`**Luminate week applied by the Mac helper**: ${names([...taken, ...kept])}${gain}${top}.`);
  }
  if (held.length) parts.push(`Held back for you: ${held.map((h) => `${h.portfolioName || h.portfolioId || h.fileName} (${firstSentence(h.reason)})`).join("; ")}.`);
  if (!parts.length) return null;
  return `${parts.join(" ")} [Open dashboard](${DASHBOARD})`;
}
const firstSentence = (s) => String(s || "").split(/(?<=\.)\s/)[0].replace(/\.$/, "").replace(/^This file /, "it ");

// What the Luminate page's status line and held list read: is a helper set up, when it last checked
// in, its last upload, and the files waiting for a person (no CSVs)
export async function helperState() {
  const [st, held, recent] = await Promise.all([
    getState(STATE_KEY).catch(() => null),
    rowsOrNoneIfNoTable(sql`SELECT id, device, file_name, portfolio_id, exported_at, received_at, reason FROM luminate_helper_files WHERE status = 'held' ORDER BY received_at`),
    rowsOrNoneIfNoTable(sql`SELECT file_name, portfolio_id, exported_at, received_at, status FROM luminate_helper_files WHERE status <> 'held' ORDER BY received_at DESC LIMIT 8`),
  ]);
  return {
    on: helperOn(), devices: helperDevices().map((d) => d.name), lastSeen: st?.lastSeen || null, device: st?.device || null, lastUpload: st?.lastUpload || null,
    held: held.map((h) => ({ id: h.id, fileName: h.file_name, portfolioId: h.portfolio_id, exportedAt: h.exported_at, receivedAt: h.received_at, reason: h.reason, device: h.device })),
    recent: recent.map((r) => ({ fileName: r.file_name, portfolioId: r.portfolio_id, exportedAt: r.exported_at, receivedAt: r.received_at, status: r.status })),
  };
}

// Staff on a held file: "apply" takes it in the way the drop zone's Apply does (force: apply even though
// the checks refused it; area: what a new portfolio holds), with the drop's own ClickUp message;
// "discard" drops the CSV. Returns [status, json].
export async function decideHeld({ id, action, force = false, area = null }, staff) {
  const [f] = await sql`SELECT * FROM luminate_helper_files WHERE id = ${String(id || "")} AND status = 'held'`;
  if (!f) return [404, { error: "That file isn't waiting anymore. Reload the page." }];
  if (action === "discard") {
    await sql`UPDATE luminate_helper_files SET status = 'discarded', csv = NULL, decided_by = ${staff}, decided_at = now() WHERE id = ${f.id}`;
    return [200, { ok: true }];
  }
  if (action !== "apply") return [400, { error: "Unknown action." }];
  const p = parseExport(f.file_name, f.csv || "");
  if (p.error) return [400, { error: p.error }];
  const a = (await areasFor([p], area ? { [p.portfolioId]: area } : {})).get(p.portfolioId);
  if (!a.area) return [400, { error: "Pick what this portfolio holds, then apply it.", needsArea: true, guess: a.guess }];
  const done = await takeExports([{ ...p, area: a.area, portfolioName: a.name }], { by: staff, force: !!force });
  const r = done[0];
  if (r.status === "blocked") return [409, { error: r.message, blocked: true, notes: r.notes }];
  await sql`UPDATE luminate_helper_files SET status = ${r.status === "taken" ? (isAR(r.area) ? "kept" : "applied") : "older"}, csv = NULL, decided_by = ${staff}, decided_at = now() WHERE id = ${f.id}`;
  if (r.status !== "taken") return [200, { ok: true, result: r }];
  let run = null;
  if (isAR(r.area)) { await markArKept([r], staff); await notifyClickUp([...arLines([r]), `[Open dashboard](${DASHBOARD})`].join("\n")); }
  else run = await afterExports({ taken: [r], by: staff });
  await runLuminateWeek();
  return [run?.error ? 502 : 200, { ok: !run?.error, result: r, ...(run && { summary: run.summary }), error: run?.error || undefined }];
}
