// List B #9, the Monday digests. Server only.
//   Team digest (ClickUp's "Weekly Digest" channel, DIGEST_CHANNEL_ID), two messages (the owner, 2026-11-10):
//     the roster's top 5 artists (Spotify streams this week vs last week, and follower growth per platform,
//     from the automated numbers' snapshots) and top 5 songs, then the other tracked artists' top 5 (the
//     Watchlist's momentum, topMomentum) and tracked songs' top 5, each with its numbers, % growth and a link.
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
// the team digest's two messages: [key, its sections]
export const TEAM_MESSAGES = [["roster", ["roster", "rosterSongs"]], ["tracked", ["watchlist", "trackedSongs"]]];
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
// week); (2026-11-10, the owner: "lets do spotify") an artist with this week's streams but no week before it yet
// comes next, by this week's streams (the roster went daily on Nov 10, so at first that's everyone); then by
// follower growth when an artist has no Spotify streams at all.
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
    const week = !s && !(a.streams?.lastWeek > 0) && a.streams?.thisWeek > 0 ? a.streams : null; // this week only
    const score = s ? (s.pct > 0 ? s.pct * 100 : null) : week ? week.thisWeek : bestF ? bestF.pct : null;
    if (score == null || score <= 0) continue;
    out.push({
      id: a.id, clientId: a.clientId, name: a.name, by: s ? "streams" : week ? "week" : "followers", score,
      streams: s ? { thisWeek: s.thisWeek, lastWeek: s.lastWeek, pct: pct1(s.pct), label: "Spotify streams, global" }
        : week ? { thisWeek: week.thisWeek, lastWeek: null, pct: null, label: "Spotify streams, global" } : null,
      followers: followers.filter((f) => f.pct !== 0),
      url: `${DASHBOARD_URL}/catalog/${encodeURIComponent(`client:${a.clientId}`)}`,
    });
  }
  // streams week on week first (the steadier number), then this week's streams, then followers
  const rank = { streams: 0, week: 1, followers: 2 };
  return out.sort((x, y) => rank[x.by] - rank[y.by] || y.score - x.score).slice(0, n);
}

// Songs (2026-11-10: "5 for our roster songs and 5 for tracked songs"). Pure. [{ id, name, artist, url, thisWeek,
// lastWeek, pct (percent) }] -> the top n: risers by Spotify streams this week vs last week (at least 1,000 this
// week), then, while there aren't two weeks of numbers, the most streamed this week fills what's left.
export function songMoversOf(songs, { n = N } = {}) {
  const ok = songs.filter((x) => x.thisWeek != null && x.thisWeek >= 1000);
  const up = ok.filter((x) => x.pct != null && x.lastWeek > 0 && x.pct > 0).sort((a, b) => b.pct - a.pct);
  const seen = new Set(up.map((x) => x.id));
  const most = ok.filter((x) => !seen.has(x.id) && x.pct == null).sort((a, b) => b.thisWeek - a.thisWeek);
  return [...up, ...most].slice(0, n);
}
// the roster's songs, from the same summary as the artists (summary.artists[].songs; pct there is a fraction)
export function rosterSongsOf(summary, { n = N } = {}) {
  const byId = new Map();
  for (const a of summary?.artists || []) {
    if (!a.clientId) continue;
    for (const s of a.songs || []) {
      if (byId.has(s.id) || !s.streams) continue;
      byId.set(s.id, { id: s.id, name: s.name, artist: s.artist || a.name, thisWeek: s.streams.thisWeek, lastWeek: s.streams.lastWeek, pct: pct1(s.streams.pct),
        url: `${DASHBOARD_URL}/catalog/${encodeURIComponent(`client:${a.clientId}`)}` });
    }
  }
  return songMoversOf([...byId.values()], { n });
}
// the A&R lists' songs that aren't the roster's (lib/ar/lists.js rows; m.streams: d7 = this week, p7 = percent)
export function trackedSongsOf(rows, { n = N } = {}) {
  const songs = (rows || []).filter((r) => r.kind === "song" && !r.roster && !r.tracking?.roster).map((r) => {
    const x = r.m?.streams || {};
    return { id: r.key, name: r.name, artist: r.artist || "", thisWeek: x.d7 ?? null, lastWeek: x.lastWeek ?? null, pct: x.p7 == null ? null : Math.round(x.p7 * 10) / 10, url: `${DASHBOARD_URL}/ar/item/${encodeURIComponent(r.key)}` };
  });
  return songMoversOf(songs, { n });
}

const safe = async (f) => { try { return { items: (await f()) || [] }; } catch (err) { console.error("digest section failed:", err?.message); return { error: "Couldn't read this part this week." }; } };
const arUrl = (sub) => `${DASHBOARD_URL}/ar${sub ? `/${sub}` : ""}`;

// The team digest's sections for one viewer's access (the preview), or at team level (access null: the
// channel post). -> { week, sections: [{ key, title, note, items, pending, empty, error }] }
export async function buildTeamDigest({ now = new Date(), access = null } = {}) {
  const can = (k) => !access || access.sections.includes(k);
  const own = access?.ownOnly ? access.clientIds || [] : null;
  const ar = arFns();
  const sections = [];
  if (can("publishing")) {
    const summary = await loadSummary({ clientIds: own, now }).catch((err) => { console.error("digest summary failed:", err?.message); return null; });
    const sum = async (f) => (summary ? safe(async () => f(summary)) : { error: "Couldn't read this part this week." });
    sections.push({ key: "roster", title: "Roster artists: top 5", note: "Spotify streams, global, this week vs last week; until there are two weeks, the most streamed this week", ...(await sum(rosterMoversOf)), empty: "No week-on-week numbers yet: they start a week after the first daily update." });
    sections.push({ key: "rosterSongs", title: "Roster songs: top 5", note: "Spotify streams this week vs last week; until there are two weeks, the most streamed this week", ...(await sum(rosterSongsOf)), empty: "No song has a week of Spotify numbers yet." });
  }
  // (2026-11-10: TikTok sounds are no longer in it; the owner asked for the two artist messages only)
  if (can("ar")) {
    sections.push({ key: "watchlist", title: "Tracked artists: top 5 by momentum", note: "The Watchlist's artists, not the roster: the growth behind each score", ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "watchlist", userId: null })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("watch") })))), empty: "No tracked artist is moving this week." });
    sections.push({ key: "trackedSongs", title: "Tracked songs: top 5", note: "The Watchlist's songs, not the roster's: Spotify streams this week vs last week; until there are two weeks, the most streamed this week", ...(await safe(async () => trackedSongsOf((await (await import("./ar/lists")).arLists({ view: "team", now: now.getTime() })).rows))), empty: "No tracked song has a week of Spotify numbers yet." });
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
    sections.push({ key: "mine", title: "Your A&R list: top movers", note: "With the growth behind each", ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "team", userId: user.id })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("mine") })))), empty: "Nothing on your list moved this week." });
    sections.push({ key: "expiring", title: "About to expire", note: "In the next 7 days: renew them in A&R › My A&R", ...(await safe(async () => (await ar.expiringSoon({ userId: user.id, days: 7 })).map((t) => ({ ...t, expiresAt: t.expiresAt || t.mine?.endsAt || "", url: t.url || arUrl("mine") })))), empty: "None in the next 7 days." });
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
    if (it.streams) parts.push(`${n0(it.streams.thisWeek)} streams this week${it.streams.pct != null ? ` (${sign(it.streams.pct)} vs ${n0(it.streams.lastWeek)})` : ""}`);
    for (const f of it.followers || []) parts.push(`${f.label} ${f.approx ? "about " : ""}${n0(f.latest)} (${sign(f.pct)})`);
    return `[${md(it.name)}](${it.url}) — ${parts.join(" · ")}`;
  }
  if (key === "rosterSongs" || key === "trackedSongs") return `[${md(it.name)}${it.artist ? ` — ${md(it.artist)}` : ""}](${it.url}) — ${n0(it.thisWeek)} streams this week${it.pct != null && it.lastWeek > 0 ? ` (${sign(it.pct)} vs ${n0(it.lastWeek)})` : ""}`;
  // a sound with no title reads "TikTok sound", as A&R › Sounds shows it (never an empty "[](url)" link)
  if (key === "radar") return `[${md(it.title || "TikTok sound")}${it.artist ? ` — ${md(it.artist)}` : ""}](${it.url}) — ${n0(it.newVideos)} new videos${it.pct != null ? ` (${sign(Math.round(it.pct * 10) / 10)})` : ""}`;
  if (key === "watchlist" || key === "mine") return `[${md(it.name)}](${it.url}) — momentum ${n0(it.score)}${it.trend != null && it.trend !== "" ? ` (${typeof it.trend === "number" ? sign(Math.round(it.trend * 10) / 10) : md(it.trend)})` : ""}${it.why ? ` · ${md(it.why)}` : ""}`;
  if (key === "expiring") return `[${md(it.name || it.title || "A tracker")}](${it.url})${it.expiresAt || it.expires ? ` — ends ${String(it.expiresAt || it.expires).slice(0, 10)}` : ""}`;
  return md(it.name || it.title || "");
}
const sectionText = (s) => {
  const rows = s.pending ? [`_${s.pending}._`] : s.error ? [`_${s.error}_`] : !s.items.length ? [`_${s.empty}_`] : s.items.map((it, i) => `${i + 1}. ${lineOf(s.key, it)}`);
  return [`**${s.title}**${s.note ? ` (${s.note})` : ""}`, ...rows].join("\n");
};
// a personal digest: one message
export function messageOf(d) {
  const head = d.kind === "team" ? `**Weekly Digest — week of ${weekWords(d.week)}**` : `**Your Weekly Digest — week of ${weekWords(d.week)}**`;
  return [head, ...d.sections.map(sectionText), `[Open the dashboard](${DASHBOARD_URL})`].join("\n\n");
}
// the team digest: one message per TEAM_MESSAGES entry whose section is in it -> [{ key, content }]
export function teamMessagesOf(d) {
  return TEAM_MESSAGES.map(([key, secs]) => {
    const ss = secs.map((k) => d.sections.find((x) => x.key === k)).filter(Boolean);
    return ss.length > 0 && { key, content: [`**Weekly Digest — week of ${weekWords(d.week)}**`, ...ss.map(sectionText), `[Open the dashboard](${key === "roster" ? `${DASHBOARD_URL}/catalog` : arUrl("watch")})`].join("\n\n") };
  }).filter(Boolean);
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
  // team: its two messages, each claimed on its own (<week>|team = roster, <week>|team:tracked), so a retry
  // never posts one twice
  out.team = {};
  const channel = String(process.env.DIGEST_CHANNEL_ID || "").trim();
  let msgs = null;
  for (const [key] of TEAM_MESSAGES) {
    const tid = key === "roster" ? `${week}|team` : `${week}|team:${key}`;
    if (!(await claim(tid, { week, kind: "team" }))) { out.team[key] = "already sent"; continue; }
    msgs = msgs || teamMessagesOf(await buildTeamDigest({ now }));
    const content = msgs.find((m) => m.key === key)?.content || "";
    if (!on) { await finish(tid, { status: "off", channel, content }); out.team[key] = "off"; }
    else if (!channel) { await finish(tid, { status: "failed", error: "DIGEST_CHANNEL_ID isn't set.", content }); out.team[key] = "no channel"; }
    else {
      try { await postTo(channel, content); await finish(tid, { status: "sent", channel, content }); out.team[key] = "sent"; }
      catch (err) { await finish(tid, { status: "failed", channel, error: err.message, content }); out.team[key] = "failed"; }
    }
  }
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
