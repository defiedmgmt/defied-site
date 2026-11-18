// List B #9, the Monday digests. Server only.
//   Team digest (ClickUp's "Weekly Digest" channel, DIGEST_CHANNEL_ID): ONE message (2026-11-16, the owner: simpler; it was
//     two), four lists of 5: Our artists (the roster's top Spotify streams this week vs last week, from the automated
//     numbers' snapshots), Our songs, On the radar (the A&R Watchlist's fastest-growing artists, topMomentum) and Radar songs
//     (the tracked songs), each with its number, the change since last week and a link. Short numbers (1.2M, 84K); a change
//     reads ▲ 8%, ▼ 3%, "no change", or "new" while there is no week before it. No followers, no long notes.
//   Personal digest (a ClickUp direct message from Defied Bot, the token's owner): the top 5 movers on
//     the person's own A&R tracker and their trackers about to expire. Opt-in (2026-11-16): nobody gets one unless
//     DIGEST_PERSONAL_TO names who ("all", or names or emails).
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
import { alert } from "./alerts";

export const DASHBOARD_URL = "https://www.defiedmgmt.com/dashboard";
// the team message's four lists, in its order: key -> [heading, what it's about]
const TEAM_LISTS = { roster: ["Our artists", "Spotify streams this week"], rosterSongs: ["Our songs", ""], watchlist: ["On the radar", "fastest-growing on the A&R watchlist"], trackedSongs: ["Radar songs", ""] };
const headOf = (key) => ({ title: TEAM_LISTS[key][0], note: TEAM_LISTS[key][1] });
const NOTHING = "Nothing to show yet.";
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
// channel post). -> { week, sections: [{ key, title, note, items, pending, empty, error }] }; teamMessageOf makes the message
export async function buildTeamDigest({ now = new Date(), access = null } = {}) {
  const can = (k) => !access || access.sections.includes(k);
  const own = access?.ownOnly ? access.clientIds || [] : null;
  const ar = arFns();
  const sections = [];
  if (can("publishing")) {
    const summary = await loadSummary({ clientIds: own, now }).catch((err) => { console.error("digest summary failed:", err?.message); return null; });
    const sum = async (f) => (summary ? safe(async () => f(summary)) : { error: "Couldn't read this part this week." });
    // (2026-11-16) the list is Spotify streams: an artist ranked only by follower growth has no stream number to show, so it isn't in it
    sections.push({ key: "roster", ...headOf("roster"), ...(await sum((x) => rosterMoversOf(x).filter((a) => a.streams))), empty: NOTHING });
    sections.push({ key: "rosterSongs", ...headOf("rosterSongs"), ...(await sum(rosterSongsOf)), empty: NOTHING });
  }
  // (2026-11-10: TikTok sounds are no longer in it)
  if (can("ar")) {
    sections.push({ key: "watchlist", ...headOf("watchlist"), ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "watchlist", userId: null })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("watch") })))), empty: NOTHING });
    sections.push({ key: "trackedSongs", ...headOf("trackedSongs"), ...(await safe(async () => trackedSongsOf((await (await import("./ar/lists")).arLists({ view: "team", now: now.getTime() })).rows))), empty: NOTHING });
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
    sections.push({ key: "mine", title: "Your A&R list", note: "top movers", ...(await safe(async () => (await ar.topMomentum({ n: N, scope: "team", userId: user.id })).filter((m) => m.score != null).slice(0, N).map((m) => ({ ...m, url: m.url || arUrl("mine") })))), empty: "Nothing on your list moved this week." });
    sections.push({ key: "expiring", title: "About to expire", note: "in the next 7 days: renew them in A&R › My A&R", ...(await safe(async () => (await ar.expiringSoon({ userId: user.id, days: 7 })).map((t) => ({ ...t, expiresAt: t.expiresAt || t.mine?.endsAt || "", url: t.url || arUrl("mine") })))), empty: "None in the next 7 days." });
  }
  return { kind: "personal", week: digestWeek(now), user: { id: user.id, name: user.name || user.email }, sections };
}

// ---------------------------------------------------------------- the message
// (2026-11-16) short numbers: 1,250,000 -> 1.3M, 84,400 -> 84K, 9,850 -> 9.9K, 999 -> 999. A whole .0 is dropped (2,000,000 -> 2M,
// 1,000 -> 1K), halves round up, and a number that rounds up into the next unit moves to it (999,600 -> 1M, 9,999 -> 10K).
export function shortNum(v) {
  const n = v == null || v === "" ? NaN : Math.round(Number(v));
  if (!Number.isFinite(n)) return "";
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e4) { const k = Math.round(n / 1e3); return k >= 1000 ? "1M" : `${k}K`; }
  if (n >= 1e3) return `${Math.round(n / 100) / 10}K`;
  return String(n);
}
// the change since last week from its percent: "▲ 8%" or "▼ 3%" (a whole number, no minus sign), "no change" when that rounds to 0,
// and "new" when there's no number from last week to compare with
export function changeOf(pct, lastWeek) {
  const p = pct == null || pct === "" ? NaN : Number(pct);
  if (!Number.isFinite(p) || !(Number(lastWeek) > 0)) return "new";
  const r = Math.round(Math.abs(p));
  return r === 0 ? "no change" : `${p > 0 ? "▲" : "▼"} ${r}%`;
}
const md = (s) => String(s ?? "").replace(/([[\]*_`])/g, "\\$1");
const dot = (...parts) => parts.filter(Boolean).join(" · ");
// one list item's text, after its "1. "
export function lineOf(key, it) {
  if (key === "roster") return dot(`[${md(it.name)}](${it.url})`, it.streams && `${shortNum(it.streams.thisWeek)} ${changeOf(it.streams.pct, it.streams.lastWeek)}`);
  if (key === "rosterSongs" || key === "trackedSongs") return dot(`[${md(it.name)}](${it.url})`, md(it.artist), `${shortNum(it.thisWeek)} ${changeOf(it.pct, it.lastWeek)}`);
  if (key === "watchlist" || key === "mine") return dot(`[${md(it.name)}](${it.url})`, `score ${shortNum(it.score)}`, md(it.why));
  if (key === "expiring") return dot(`[${md(it.name || it.title || "A tracker")}](${it.url})`, (it.expiresAt || it.expires) && `ends ${String(it.expiresAt || it.expires).slice(0, 10)}`);
  return md(it.name || it.title || "");
}
const sectionText = (s) => {
  const rows = s.pending ? [`_${s.pending}._`] : s.error ? [`_${s.error}_`] : !s.items?.length ? [`_${s.empty || NOTHING}_`] : s.items.map((it, i) => `${i + 1}. ${lineOf(s.key, it)}`);
  return [`**${s.title}**${s.note ? ` · ${s.note}` : ""}`, ...rows].join("\n");
};
// The team digest as its ONE message (2026-11-16; it was two): the four lists in their order, each only if the digest has it (the
// preview for an account without A&R has two). Pure: d is buildTeamDigest's answer, and the lists' headings are this file's, so a
// section needs only its key and its items (or error).
export function teamMessageOf(d) {
  const lists = Object.keys(TEAM_LISTS).map((key) => { const s = (d.sections || []).find((x) => x.key === key); return s && { ...s, ...headOf(key) }; }).filter(Boolean);
  return [`**Defied weekly · week of ${weekWords(d.week)}**`, ...lists.map(sectionText), `[Open the dashboard](${DASHBOARD_URL})`].join("\n\n");
}
// one digest as a message: the team's, or a personal one
export function messageOf(d) {
  if (d.kind === "team") return teamMessageOf(d);
  return [`**Your Defied weekly · week of ${weekWords(d.week)}**`, ...d.sections.map(sectionText), `[Open the dashboard](${DASHBOARD_URL})`].join("\n\n");
}

// ---------------------------------------------------------------- sending (DIGEST_WRITES)
async function cu(path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not configured.");
  const r = await fetch(`https://api.clickup.com${path}`, { method, headers: { Authorization: token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`ClickUp ${method} ${path.split("?")[0].replace(/\/[0-9a-z-]{6,}(?=\/|$)/gi, "/…")}: ${r.status}`);
  return j;
}
// (2026-11-17) exported for lib/alerts.js (a failed job's message goes the same way, with a shorter timeout)
export const postTo = (channel, content, { timeoutMs } = {}) => cu(`/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${encodeURIComponent(channel)}/messages`, { method: "POST", body: { type: "message", content, content_format: "text/md" }, timeoutMs });
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

// who gets a personal digest: DIGEST_PERSONAL_TO = "all", or names / emails separated by commas. Opt-in (2026-11-16, it
// used to default to "devin"): unset or blank, nobody does
export function personalPeople(users, to = process.env.DIGEST_PERSONAL_TO) {
  const want = String(to ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return [];
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

// The Monday run: the team digest, then each person's. Returns what happened to each. (2026-11-17) A row that ends "failed" tells the
// founders in ClickUp (lib/alerts.js): the team's, or a person's by name; the second Monday cron trying a failed row again is the same alert.
// The messages are sent side by side with the rest and waited for once at the end (each gives up after 5 seconds), so they never add up.
const JOB = "Weekly digest";
export async function runDigests({ now = new Date() } = {}) {
  const on = digestWritesOn();
  const week = digestWeek(now);
  const out = { week, writes: on, team: null, personal: [] };
  const told = [];
  // team: ONE message (2026-11-16; it was two, <week>|team and <week>|team:tracked), claimed as <week>|team, so a retry
  // never posts it twice
  const channel = String(process.env.DIGEST_CHANNEL_ID || "").trim();
  const tid = `${week}|team`;
  if (!(await claim(tid, { week, kind: "team" }))) out.team = "already sent";
  else {
    const content = teamMessageOf(await buildTeamDigest({ now }));
    if (!on) { await finish(tid, { status: "off", channel, content }); out.team = "off"; }
    else if (!channel) { await finish(tid, { status: "failed", error: "DIGEST_CHANNEL_ID isn't set.", content }); out.team = "no channel"; told.push(alert({ job: JOB, step: "the team digest", error: "DIGEST_CHANNEL_ID isn't set.", now })); }
    else {
      try { await postTo(channel, content); await finish(tid, { status: "sent", channel, content }); out.team = "sent"; }
      catch (err) { await finish(tid, { status: "failed", channel, error: err.message, content }); out.team = "failed"; told.push(alert({ job: JOB, step: "the team digest", error: err.message, now })); }
    }
  }
  // personal
  // (2026-11-14) only logins: a person the site made with no login yet (lib/people-link.js) gets nothing until a Founder
  // gives them one
  const users = await sql`SELECT id, email, name, clickup_user_id FROM users WHERE role = 'staff' AND email IS NOT NULL AND password_hash IS NOT NULL ORDER BY name`;
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
      told.push(alert({ job: JOB, step: `${u.name || u.email}'s personal digest`, error: err.message, now }));
    }
  }
  await Promise.all(told);
  return out;
}
