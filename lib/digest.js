// List B #9, the Monday digests. Server only.
//   Team digest (one ClickUp channel, DIGEST_CHANNEL_ID): Roster's top 5 movers (Spotify streams this
//     week vs last week, and follower growth per platform, from the automated numbers' snapshots), Radar's
//     top 5 growing sounds (A&R's topRisingSounds) and the Watchlist's top 5 momentum (topMomentum), each
//     with its numbers, % growth and a link that opens the right page.
//   Personal digest (a ClickUp direct message from Defied Bot, the token's owner): the top 5 movers on
//     the person's own A&R tracker and their trackers about to expire. Starts with Devin only
//     (DIGEST_PERSONAL_TO, "all" for everyone).
//   Each one follows the person's permissions (lib/access.js): no A&R access, no A&R sections; an account
//     limited to its own artists sees only theirs. The team digest goes to the team channel, so it is
//     built at team level and has no Money in it at all.
// Sending is off unless DIGEST_WRITES is "on" (default off): with it off, a Monday run still builds
// every digest and records it in digest_runs (status "off"), so "Preview this week's digest" and the
// log show exactly what would have gone out. Nothing is ever made up: a section without numbers says
// so (the A&R sections read lib/ar/*: real tracker, radar and momentum rows).
import { sql } from "./db";
import { loadSummary } from "./data/summary";
import { loadAccess } from "./access";
import { arFns } from "./links/ar-bridge";
import { personKey } from "./names";

export const DASHBOARD_URL = "https://www.defiedmgmt.com/dashboard";
const WORKSPACE_ID = "90141502305"; // Defied Management (lib/clickup.js)
export const digestWritesOn = () => /^(on|true|1|yes)$/i.test(String(process.env.DIGEST_WRITES || "").trim());
const N = 5;

// ---------------------------------------------------------------- New York time
// The two Monday crons (13:00 and 14:00 UTC; Hobby fires them within the hour) cover both EDT and EST:
// whichever first finds it Monday 8:00-11:59 in New York sends, and digest_runs stops the second.
export function nyParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const dueNow = (now = new Date()) => { const p = nyParts(now); return p.weekday === "Mon" && p.hour >= 8 && p.hour < 12; };
// the Monday (New York) of the week `now` is in
export function digestWeek(now = new Date()) {
  const p = nyParts(now);
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday] || 0;
  const d = new Date(`${p.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const weekWords = (week) => new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------- the sections
const pct1 = (p) => (p == null ? null : Math.round(p * 1000) / 10); // fraction -> one-decimal percent
// Roster: Pure. summary = lib/data/summary.js buildSummary's answer. Risers only (a drop never sits in a
// "top movers" list): ranked by streams week on week (at least 1,000 streams this week, and some last
// week), then by follower growth when an artist has no streams to compare.
export function rosterMoversOf(summary, { n = N } = {}) {
  const out = [];
  for (const a of summary?.artists || []) {
    if (!a.clientId) continue;
    const s = a.streams && a.streams.thisWeek != null && a.streams.lastWeek > 0 && a.streams.thisWeek >= 1000 && a.streams.pct != null ? a.streams : null;
    const followers = Object.entries(a.metrics || {})
      // follower growth = this week's gain over the count a week ago (stats' growthPct), not the gain's own change
      .filter(([k, v]) => /followers|subscribers|listeners/.test(k) && v.growthPct != null && v.latest != null)
      .map(([k, v]) => ({ key: k, label: v.label, latest: v.latest, pct: pct1(v.growthPct), approx: !!v.approx }));
    const bestF = followers.filter((f) => f.pct > 0).sort((x, y) => y.pct - x.pct)[0] || null;
    const score = s ? (s.pct > 0 ? s.pct * 100 : null) : bestF ? bestF.pct : null;
    if (score == null || score <= 0) continue;
    out.push({
      id: a.id, clientId: a.clientId, name: a.name, by: s ? "streams" : "followers", score,
      streams: s ? { thisWeek: s.thisWeek, lastWeek: s.lastWeek, pct: pct1(s.pct), label: "Spotify streams, global" } : null,
      followers: followers.filter((f) => f.pct !== 0),
      url: `${DASHBOARD_URL}?tab=catalog&sub=${encodeURIComponent(`client:${a.clientId}`)}`,
    });
  }
  // streams first (the steadier number), then followers
  return out.sort((x, y) => (x.by === y.by ? y.score - x.score : x.by === "streams" ? -1 : 1)).slice(0, n);
}

const safe = async (f) => { try { return { items: (await f()) || [] }; } catch (err) { console.error("digest section failed:", err?.message); return { error: "Couldn't read this part this week." }; } };
const arUrl = (sub) => `${DASHBOARD_URL}?tab=ar${sub ? `&sub=${encodeURIComponent(sub)}` : ""}`;

// The team digest's sections for one viewer's access (the preview), or at team level (access null: the
// channel post). -> { week, sections: [{ key, title, note, items, pending, empty, error }] }
export async function buildTeamDigest({ now = new Date(), access = null } = {}) {
  const can = (k) => !access || access.sections.includes(k);
  const own = access?.ownOnly ? access.clientIds || [] : null;
  const ar = arFns();
  const sections = [];
  if (can("publishing")) {
    const r = await safe(async () => rosterMoversOf(await loadSummary({ clientIds: own, now })));
    sections.push({ key: "roster", title: "Roster: top movers", note: "Spotify streams, global, this week vs last week; follower growth per platform", ...r, empty: "No week-on-week numbers yet: they start a week after the first daily update." });
  }
  if (can("ar")) {
    sections.push({ key: "radar", title: "Radar: growing sounds", note: "New TikTok videos with each sound this week", ...(await safe(async () => (await ar.topRisingSounds({ n: N })).slice(0, N).map((s) => ({ ...s, url: s.url || arUrl("radar") })))), empty: "No sound grew this week." });
    sections.push({ key: "watchlist", title: "Watchlist: top momentum", note: "The growth behind each score", ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "watchlist", userId: null })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("watchlist") })))), empty: "No watchlist artist is moving this week." });
  }
  return { kind: "team", week: digestWeek(now), sections };
}

// One person's digest. user: { id, name, email }. -> { kind, week, user, sections } (no sections: nothing
// they may see, e.g. no A&R access)
export async function buildPersonalDigest(user, { now = new Date(), access } = {}) {
  const acc = access || await loadAccess(user);
  const ar = arFns();
  const sections = [];
  if (acc.sections.includes("ar")) {
    sections.push({ key: "mine", title: "Your tracker: top movers", note: "With the growth behind each", ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "team", userId: user.id })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("trackers") })))), empty: "Nothing on your tracker moved this week." });
    sections.push({ key: "expiring", title: "Trackers about to expire", note: "In the next 7 days", ...(await safe(async () => (await ar.expiringSoon({ userId: user.id, days: 7 })).map((t) => ({ ...t, expiresAt: t.expiresAt || t.mine?.endsAt || "", url: t.url || arUrl("trackers") })))), empty: "None in the next 7 days." });
  }
  return { kind: "personal", week: digestWeek(now), user: { id: user.id, name: user.name || user.email }, sections };
}

// ---------------------------------------------------------------- the message
const n0 = (v) => (v == null ? "" : Math.round(Number(v)).toLocaleString("en-US"));
const sign = (p) => (p == null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`);
const md = (s) => String(s ?? "").replace(/([[\]*_`])/g, "\\$1");
export function lineOf(key, it) {
  if (key === "roster") {
    const parts = [];
    if (it.streams) parts.push(`${n0(it.streams.thisWeek)} streams this week (${sign(it.streams.pct)} vs ${n0(it.streams.lastWeek)})`);
    for (const f of it.followers || []) parts.push(`${f.label} ${f.approx ? "about " : ""}${n0(f.latest)} (${sign(f.pct)})`);
    return `[${md(it.name)}](${it.url}) — ${parts.join(" · ")}`;
  }
  if (key === "radar") return `[${md(it.title)}${it.artist ? ` — ${md(it.artist)}` : ""}](${it.url}) — ${n0(it.newVideos)} new videos${it.pct != null ? ` (${sign(Math.round(it.pct * 10) / 10)})` : ""}`;
  if (key === "watchlist" || key === "mine") return `[${md(it.name)}](${it.url}) — momentum ${n0(it.score)}${it.trend != null && it.trend !== "" ? ` (${typeof it.trend === "number" ? sign(Math.round(it.trend * 10) / 10) : md(it.trend)})` : ""}${it.why ? ` · ${md(it.why)}` : ""}`;
  if (key === "expiring") return `[${md(it.name || it.title || "A tracker")}](${it.url})${it.expiresAt || it.expires ? ` — ends ${String(it.expiresAt || it.expires).slice(0, 10)}` : ""}`;
  return md(it.name || it.title || "");
}
export function messageOf(d) {
  const head = d.kind === "team" ? `**Monday digest — week of ${weekWords(d.week)}**` : `**Your Monday digest — week of ${weekWords(d.week)}**`;
  const body = d.sections.map((s) => {
    const rows = s.pending ? [`_${s.pending}._`] : s.error ? [`_${s.error}_`] : !s.items.length ? [`_${s.empty}_`] : s.items.map((it, i) => `${i + 1}. ${lineOf(s.key, it)}`);
    return [`**${s.title}**${s.note ? ` (${s.note})` : ""}`, ...rows].join("\n");
  });
  return [head, ...body, `[Open the dashboard](${DASHBOARD_URL})`].join("\n\n");
}

// ---------------------------------------------------------------- sending (DIGEST_WRITES)
async function cu(path, { method = "GET", body } = {}) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not configured.");
  const r = await fetch(`https://api.clickup.com${path}`, { method, headers: { Authorization: token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`ClickUp ${method} ${path.split("?")[0].replace(/\/[0-9a-z-]{6,}(?=\/|$)/gi, "/…")}: ${r.status}`);
  return j;
}
const postTo = (channel, content) => cu(`/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${encodeURIComponent(channel)}/messages`, { method: "POST", body: { type: "message", content, content_format: "text/md" } });
// a person's ClickUp id: users.clickup_user_id, else the workspace member with their email (read only)
let members = null;
export const resetMembers = () => { members = null; };
async function clickupIdOf(user) {
  if (String(user.clickup_user_id || "").trim()) return String(user.clickup_user_id).trim();
  if (!members) {
    const j = await cu("/api/v2/team");
    members = (j?.teams || []).find((t) => String(t.id) === WORKSPACE_ID)?.members || j?.teams?.[0]?.members || [];
  }
  const m = members.find((x) => String(x.user?.email || "").toLowerCase() === String(user.email || "").toLowerCase());
  return m ? String(m.user.id) : "";
}
async function dmChannel(clickupId) {
  const j = await cu(`/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/direct_message`, { method: "POST", body: { user_ids: [clickupId] } });
  const id = j?.data?.id || j?.id;
  if (!id) throw new Error("ClickUp didn't open the direct message.");
  return String(id);
}

// who gets a personal digest: DIGEST_PERSONAL_TO = "all", or names / emails separated by commas
// (default "devin": the owner first)
export function personalPeople(users, to = process.env.DIGEST_PERSONAL_TO) {
  const want = String(to == null || to === "" ? "devin" : to).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (want.includes("all")) return users;
  return users.filter((u) => want.some((w) => String(u.email || "").toLowerCase() === w || String(u.email || "").toLowerCase().split("@")[0] === w || personKey(String(u.name || "").split(/\s+/)[0]) === personKey(w) || personKey(u.name) === personKey(w)));
}

// claim this week's row (a failed or "off" one may be tried again; a sent one never)
async function claim(id, row) {
  const got = await sql`INSERT INTO digest_runs (id, week, kind, user_id, status, content) VALUES (${id}, ${row.week}, ${row.kind}, ${row.userId || null}, 'skipped', '')
    ON CONFLICT (id) DO UPDATE SET status = 'skipped', created_at = now() WHERE digest_runs.status IN ('failed', 'off') RETURNING id`;
  return got.length > 0;
}
const finish = (id, { status, channel = "", error = "", content = "" }) => sql`UPDATE digest_runs SET status = ${status}, channel = ${channel}, error = ${error.slice(0, 300)}, content = ${content.slice(0, 20000)}, created_at = now() WHERE id = ${id}`;

// The Monday run: the team digest, then each person's. Returns what happened to each.
export async function runDigests({ now = new Date() } = {}) {
  const on = digestWritesOn();
  const week = digestWeek(now);
  const out = { week, writes: on, team: null, personal: [] };
  // team
  const tid = `${week}|team`;
  if (await claim(tid, { week, kind: "team" })) {
    const d = await buildTeamDigest({ now });
    const content = messageOf(d);
    const channel = String(process.env.DIGEST_CHANNEL_ID || "").trim();
    if (!on) { await finish(tid, { status: "off", channel, content }); out.team = "off"; }
    else if (!channel) { await finish(tid, { status: "failed", error: "DIGEST_CHANNEL_ID isn't set.", content }); out.team = "no channel"; }
    else {
      try { await postTo(channel, content); await finish(tid, { status: "sent", channel, content }); out.team = "sent"; }
      catch (err) { await finish(tid, { status: "failed", channel, error: err.message, content }); out.team = "failed"; }
    }
  } else out.team = "already sent";
  // personal
  const users = await sql`SELECT id, email, name, clickup_user_id FROM users WHERE role = 'staff' ORDER BY name`;
  resetMembers();
  for (const u of personalPeople(users)) {
    const id = `${week}|user:${u.id}`;
    if (!(await claim(id, { week, kind: "personal", userId: u.id }))) { out.personal.push({ user: u.id, result: "already sent" }); continue; }
    const d = await buildPersonalDigest(u, { now });
    if (!d.sections.length) { await finish(id, { status: "off", error: "Nothing this account may see is in a personal digest (no A&R access)." }); out.personal.push({ user: u.id, result: "nothing to send" }); continue; }
    const content = messageOf(d);
    if (!on) { await finish(id, { status: "off", content }); out.personal.push({ user: u.id, result: "off" }); continue; }
    try {
      const cid = await clickupIdOf(u);
      if (!cid) throw new Error(`No ClickUp member with ${u.email}: set users.clickup_user_id.`);
      const ch = await dmChannel(cid);
      await postTo(ch, content);
      await finish(id, { status: "sent", channel: ch, content });
      out.personal.push({ user: u.id, result: "sent" });
    } catch (err) {
      await finish(id, { status: "failed", error: err.message, content });
      out.personal.push({ user: u.id, result: "failed", error: err.message });
    }
  }
  return out;
}
