import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, ChevronDown } from "lucide-react";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { clock } from "./chips";
import { RowMenu, Sparkline, compact, shortDay } from "./helpers";
import { fmt } from "./ui";
import { dataPost, ModeSwitch } from "./lum-history";
import { PREVIEW } from "../../lib/preview";
export { dataPost, ModeSwitch, LumHistory } from "./lum-history";
export { TodoChip } from "./chips";

/* The automated numbers' shared pieces (list B #4) --------------------------------------------- */
// r10: the Numbers tab is gone (the owner's call). Its parts live where they're used: the sources' status,
// schedule and monthly cost in Site › Sync (SyncSources; the dollars for Founders only), spikes on Home
// (HomeSpikes), each roster artist's and song's Luminate history and the artist's campaign mode on its own
// Publishing page (LumHistory, ModeSwitch), and the Monday digest's preview in Site › Sync. Sounds and
// campaign mode for the A&R lists are A&R's. Every number is labelled by platform ("Spotify streams,
// global", "Luminate, all platforms").
export const usd = (v) => `$${(Number(v) || 0).toFixed(Number(v) >= 10 ? 0 : 2)}`;
export const big = (n) => (n == null ? "—" : Math.abs(n) >= 1e4 ? compact(n).replace(/^\+/, "") : fmt(n));
const pctWord = (p) => (p == null ? null : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 100))}%`);
export function NumTile({ m, label, sub, k }) {
  if (!m) return <div className="nums-tile nums-none" data-tile={k}><span className="nums-lab">{label}</span><b>—</b><span className="nums-sub">Not read yet</span></div>;
  const week = m.thisWeek != null ? `${compact(m.thisWeek)} this week` : m.daily != null ? `${compact(m.daily)} yesterday` : null;
  const vs = pctWord(m.pct);
  return (
    <div className={`nums-tile${m.stale ? " nums-stale" : ""}`} data-tile={k}>
      <span className="nums-lab">{m.label}</span>
      <b title={fmt(m.latest)}>{m.approx ? "about " : ""}{big(m.latest)}</b>
      {(week || sub) && <span className="nums-sub">{week}{week && vs ? <> · <span className={m.pct >= 0 ? "pos" : "neg"}>{vs} vs last week</span></> : null}{sub && <>{week ? " · " : ""}{sub}</>}</span>}
      <Sparkline series={m.series} height={34} />
      <span className="nums-when" data-when>{m.stale ? <><AlertTriangle size={11} /> last updated {shortDay(m.day)}</> : `updated ${shortDay(m.day)}`}</span>
    </div>
  );
}
// List B #9: "Preview this week's digest": exactly what Monday's team digest and this account's own
// digest would say (GET /api/digest), for the sections this account may see. A Founder can look at
// anyone's personal digest, and sees who gets one and what this week's run did.
const pctSigned = (p) => (p == null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`);
function DigestItem({ k, it }) {
  const song = k === "rosterSongs" || k === "trackedSongs";
  const main = k === "radar" || song ? `${it.title || it.name}${it.artist ? ` — ${it.artist}` : ""}` : it.name || it.title || "";
  const nums = song ? [<span key="s"><b>{fmt(it.thisWeek)}</b> streams this week{it.pct != null && it.lastWeek > 0 && <> <span className={it.pct >= 0 ? "pos" : "neg"}>{pctSigned(it.pct)}</span></>}</span>]
    : k === "roster"
    ? [it.streams && <span key="s"><b>{fmt(it.streams.thisWeek)}</b> streams this week <span className={it.streams.pct >= 0 ? "pos" : "neg"}>{pctSigned(it.streams.pct)}</span></span>,
      ...(it.followers || []).map((f) => <span key={f.key}>{f.label} <b>{f.approx ? "about " : ""}{big(f.latest)}</b> <span className={f.pct >= 0 ? "pos" : "neg"}>{pctSigned(f.pct)}</span></span>)]
    : k === "radar" ? [<span key="v"><b>{fmt(it.newVideos)}</b> new videos{it.pct != null && <> <span className={it.pct >= 0 ? "pos" : "neg"}>{pctSigned(Math.round(it.pct * 10) / 10)}</span></>}</span>]
      : k === "expiring" ? [<span key="e">{it.expiresAt || it.expires ? `ends ${String(it.expiresAt || it.expires).slice(0, 10)}` : ""}</span>]
        : [<span key="m">momentum <b>{fmt(it.score)}</b>{it.trend != null && it.trend !== "" && <> · {typeof it.trend === "number" ? pctSigned(Math.round(it.trend * 10) / 10) : String(it.trend)}</>}</span>, it.why && <span key="w">{it.why}</span>];
  return (
    <li className="dg-item" data-dg-item>
      <a className="dg-name" href={it.url} target="_blank" rel="noreferrer">{main}</a>
      <span className="dg-nums">{nums.filter(Boolean)}</span>
    </li>
  );
}
function DigestBlock({ d, label }) {
  const [raw, setRaw] = useState(false);
  return (
    <section className="dg-block" data-dg={d.kind}>
      <div className="dg-head"><h3>{label}</h3><button type="button" className="inline-link dg-raw" onClick={() => setRaw(!raw)} aria-pressed={raw}>{raw ? "Show as cards" : "Show the ClickUp text"}</button></div>
      {raw ? <pre className="dg-text" data-dg-text>{d.text}</pre> : d.sections.map((s) => (
        <div key={s.key} className="dg-sec" data-dg-sec={s.key}>
          <h4>{s.title}</h4>{s.note && <p className="hint">{s.note}</p>}
          {s.pending ? <p className="dg-pending" data-dg-pending>{s.pending}.</p> : s.error ? <p className="hint err-text">{s.error}</p>
            : !s.items.length ? <p className="hint" data-dg-empty>{s.empty}</p> : <ol className="dg-list">{s.items.map((it, i) => <DigestItem key={it.id || it.url || i} k={s.key} it={it} />)}</ol>}
        </div>
      ))}
    </section>
  );
}
export function DigestPreview() {
  const [who, setWho] = useState("");
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let gone = false;
    setErr(null);
    fetch(`/api/digest${who ? `?user=${encodeURIComponent(who)}` : ""}`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't build the preview."); return j; })
      .then((j) => { if (!gone) setD(j); }).catch((e) => { if (!gone) setErr(e.message); });
    return () => { gone = true; };
  }, [who]);
  if (err) return <p className="hint err-text" role="alert">{err}</p>;
  if (!d) return <p className="hint"><RefreshCw size={14} className="spin" /> Building this week's digest…</p>;
  const me = d.people?.find((p) => p.id === d.personal.user?.id);
  return (
    <div className="dg" data-digest-preview>
      <p className="dg-status" data-dg-status>{d.writesOn ? `Posts to ClickUp ${d.schedule}.` : `Posting is off for now (DIGEST_WRITES), so nothing is sent. This is exactly what ${d.schedule.replace(/^Mondays/, "Monday")} would send.`}{d.writesOn && !d.team.channelSet ? " The team channel isn't set yet (DIGEST_CHANNEL_ID)." : ""}</p>
      <DigestBlock d={d.team} label="Team digest (2 messages in ClickUp's Weekly Digest channel)" />
      {d.people && (
        <label className="fld dg-who"><span>Personal digest for</span>
          <select value={who || d.personal.user?.id || ""} onChange={(e) => setWho(e.target.value)} aria-label="Personal digest for">
            {d.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.getsPersonal ? "" : " (not getting one yet)"}</option>)}
          </select>
        </label>
      )}
      {d.personal.sections.length ? <DigestBlock d={d.personal} label={`${d.personal.user?.name ? `${d.personal.user.name}'s` : "Your"} digest (a ClickUp direct message)`} />
        : <p className="hint" data-dg-no-personal>No personal digest: it holds A&R trackers, and this account has no A&R.</p>}
      {me && !me.getsPersonal && <p className="hint">Personal digests go to Devin first (DIGEST_PERSONAL_TO). Set it to "all" to send everyone theirs.</p>}
    </div>
  );
}
export function SoundNums({ sounds, onSaved }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const add = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await dataPost({ action: "addSound", url }); setUrl(""); await onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <div className="nums-sounds" data-nums-sounds>
      <form className="nums-add" onSubmit={add}>
        <input type="url" inputMode="url" placeholder="Paste a TikTok sound link (tiktok.com/music/…)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="TikTok sound link" />
        <button className="btn sm" disabled={busy || !url.trim()}>{busy ? "Adding…" : "Track sound"}</button>
      </form>
      {err && <p className="hint err-text" role="alert">{err}</p>}
      {!sounds.length ? <div className="admin-empty">No sounds tracked yet. Paste a TikTok sound link to start.</div> : sounds.map((s) => (
        <div key={s.id} className="nums-card" data-nums-sound={s.id}>
          <div className="nums-head nums-head-static"><span className="nums-name">{s.name || "A TikTok sound"}{s.artist && <em> · {s.artist}</em>}</span>
            {s.url && <a className="inline-link" href={s.url} target="_blank" rel="noreferrer">Open ↗</a>}
            <RowMenu label={`More for ${s.name || "this sound"}`} items={[{ label: "Stop tracking", onClick: async () => { await dataPost({ action: "removeSound", entityId: s.id }).catch(() => {}); onSaved(); } }]} /></div>
          <div className="nums-tiles"><NumTile k="videos" label="TikTok videos with this sound" m={s.videos} /></div>
          <ModeSwitch id={s.id} mode={s.mode} onSaved={onSaved} what="sound" />
        </div>
      ))}
    </div>
  );
}
// r10 fix: the month in one picture. limit: the lower of Apify's plan cap and the site's own total; over: the
// estimate is past it (stopDay: about when, at this pace); budgetsOver: the per-source budgets add up past the total
const usd2 = (v) => `$${(Number(v) || 0).toFixed(2)}`;
export function costPicture(d, now = new Date()) {
  const c = d?.cost || {}, acct = c.account || null;
  const est = Number(c.estMonthlyUsd) || 0, spent = Number(c.spentUsd) || 0, total = Number.isFinite(Number(c.totalCapUsd)) ? Number(c.totalCapUsd) : null;
  const plan = acct && Number.isFinite(Number(acct.limitUsd)) ? Number(acct.limitUsd) : null;
  const limit = plan != null && total != null ? Math.min(plan, total) : plan ?? total;
  const limitWhy = limit == null ? "" : plan != null && limit === plan ? `Apify's plan cap${total != null && total > plan ? ` (lower than the ${usd2(total)} total set here)` : ""}` : "the total set here";
  const budgets = (d?.sources || []).filter((x) => x.paid).reduce((a, x) => a + (Number(x.softCapUsd) || 0), 0);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const over = limit != null && est > limit;
  const stopDay = over ? `${now.toLocaleDateString("en-US", { month: "short" })} ${Math.max(1, Math.min(days, Math.floor((limit / est) * days)))}` : null;
  return { month: now.toLocaleDateString("en-US", { month: "long" }), est, spent, limit, limitWhy, over, stopDay, budgets, total, budgetsOver: total != null && budgets > total + 0.001 };
}
// a run where more than a tenth of what's tracked came back with no number is a warning, not small print
export const missRate = (s) => { const m = /(\d+) had no number/.exec(s?.last?.error || ""); return m && s.tracked && !UNDER_1000.has(s.key) ? Number(m[1]) / s.tracked : 0; };
// r11 fix: Spotify shows no play count under 1,000 plays, so a small song comes back with no number every time (the
// smallest reading in the preview's real data is 1,004; the 157 songs never read are almost all roster catalog songs
// found on their releases). That's said in words, not as a warning.
const UNDER_1000 = new Set(["spotify_streams"]);
export const missNote = (s) => (UNDER_1000.has(s?.key) && /had no number/.test(s?.last?.error || "") ? " Spotify shows no play count under 1,000 plays, so small songs come back empty." : "");
// Site › Sync's sources: each one's schedule, scraper, when it last ran (or why it failed or was skipped) and
// what it tracks. founder: the monthly cost, this month's spend and the budgets (the server sends no dollar
// figures to anyone else); canEdit (Money too): change the schedule, scraper and budgets.
export function SourceNums({ d, founder, canEdit, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(d.sources.map((s) => [s.key, { schedule: s.schedule, adapter: s.adapter, softCapUsd: String(s.softCapUsd ?? "") }])));
  const [total, setTotal] = useState(String(d.cost?.totalCapUsd ?? ""));
  canEdit = canEdit && founder;
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const set = (k, p) => setF((x) => ({ ...x, [k]: { ...x[k], ...p } }));
  const save = async () => { setBusy(true); setMsg(null); try { await dataPost({ action: "sources", sources: f, totalCapUsd: total }); setMsg({ ok: "Saved." }); await onSaved(); } catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); } };
  const acct = d.cost?.account;
  const pic = costPicture(d);
  return (
    <div className="nums-src" data-nums-sources>
      {/* r10 fix (LIST B #4): one monthly picture: the estimate, what's spent, the cap that really stops runs, and a
          warning when the estimate is over it */}
      {founder && d.cost && (
        <div className="nums-month" data-cost-month>
          <p className="nums-costline" data-costline>{pic.month}: about <b>{usd2(pic.est)}</b> at this schedule · <b>{usd2(pic.spent)}</b> spent so far (the site's count of its own runs)</p>
          {pic.limit != null && <p className="hint" data-cost-cap>Runs stop at <b>{usd2(pic.limit)}</b> a month: {pic.limitWhy}.{acct ? ` Apify's own count: ${usd2(acct.usageUsd)} of ${usd2(acct.limitUsd)}${acct.at ? ` as of ${shortDay(acct.at)}, ${clock(acct.at)}` : ""}, so runs after that aren't in it yet.` : ""}</p>}
          {/* r11 fix: a preview's plan is the copy it was given (it never asks Apify); the live site reads the plan
              (GET /users/me/limits) at the start of every run, so its line and warning follow the plan really on */}
          {PREVIEW && acct && <p className="hint" data-cost-preview>In this preview Apify's plan is the copy read {acct.at ? shortDay(acct.at) : "earlier"}. The live site reads the plan from Apify on every run.</p>}
          {pic.over && !PREVIEW && <p className="nums-warn" role="alert" data-cost-over>The estimate is over the {usd2(pic.limit)} cap: at this pace the updates stop around {pic.stopDay}. Set a source to weekly to stay under it.</p>}
          {pic.budgetsOver && <p className="hint" data-cost-budgets>The sources' own budgets add up to {usd2(pic.budgets)}, more than the {usd2(pic.total)} total. The total wins: a source with budget left still stops once all of them reach {usd2(pic.total)}.</p>}
        </div>
      )}
      {d.sources.map((s) => (
        <div key={s.key} className="nums-srow" data-source={s.key}>
          <div className="nums-srow-t"><b>{s.label}</b><span className="hint">{s.tracked} tracked{s.campaign ? ` · ${s.campaign} in campaign mode` : ""}{founder ? ` · about ${usd(s.estMonthlyUsd)}/month${s.paid ? ` · ${usd(s.spentUsd)} this month` : " · free"}` : s.paid ? "" : " · free"}</span>
            <span className={`hint${s.last?.status === "failed" ? " err-text" : missRate(s) > 0.1 ? " nums-warn" : ""}`} data-last data-miss={missRate(s) > 0.1 ? "warn" : undefined}>{missRate(s) > 0.1 ? "⚠ " : ""}{s.skipped ? `Skipped ${shortDay(s.skipped.at)}: ${s.skipped.why}` : s.last ? `${s.last.status === "failed" ? "Failed" : s.last.status === "started" ? "Running since" : "Last run"} ${shortDay(s.last.at)}${s.last.error ? `: ${s.last.error}` : ""}` : "Not run yet"}{missRate(s) > 0.1 ? ` That's ${Math.round(missRate(s) * 100)}% of the ${s.tracked}.` : ""}{missNote(s)}</span></div>
          {canEdit ? (
            <div className="nums-srow-f">
              {s.key !== "spotify_catalog" && <select aria-label="How often" value={f[s.key].schedule} onChange={(e) => set(s.key, { schedule: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>}
              {s.adapters.length > 1 && <select aria-label="Scraper" value={f[s.key].adapter} onChange={(e) => set(s.key, { adapter: e.target.value })}>{s.adapters.map((a) => <option key={a.id} value={a.id}>{a.actor}</option>)}</select>}
              {s.paid && <label className="nums-cap">Budget $<input type="number" min="0" max="19" step="0.5" value={f[s.key].softCapUsd} onChange={(e) => set(s.key, { softCapUsd: e.target.value })} />/mo</label>}
            </div>
          ) : <div className="nums-srow-f hint">{s.schedule === "daily" ? "Daily" : "Weekly"} · {s.adapters.find((a) => a.id === s.adapter)?.actor}{founder && s.paid ? ` · budget ${usd(s.softCapUsd)}/mo` : ""}</div>}
        </div>
      ))}
      {canEdit ? (
        <div className="nums-save"><label className="nums-cap">All sources together: $<input type="number" min="0" max="19" step="0.5" value={total} onChange={(e) => setTotal(e.target.value)} />/month</label>
          <button className="btn sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {msg && <span className={`hint${msg.err ? " err-text" : ""}`} role="status">{msg.err || msg.ok}</span>}</div>
      ) : founder ? <p className="hint">Changing schedules and budgets needs Money access.</p> : null}
      {founder && <p className="hint">Apify's own hard limit stops every run at the plan's cap. A run that would go past this month's budget waits until next month.</p>}
    </div>
  );
}
// Site › Sync (r10, from the old Numbers tab): where the automated numbers come from, whether each source ran
// on time ("last updated"), and for a Founder what a month of it costs; then the Monday digest's preview.
// Needs Publishing (GET /api/data); without it the section says so in one line.
export function SyncSources({ ctx }) {
  const founder = !ctx.db.access || ctx.db.access.role === "founder";
  const [d, setD] = useState(() => peekJson("/api/data") || null), [err, setErr] = useState(false);
  const [digest, setDigest] = useState(false);
  const load = () => swrJson("/api/data", (j) => { setD(j); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { if (ctx.can("publishing")) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx.can("publishing")) return null;
  const st = d?.state;
  const line = !st ? null : !st.refreshOn ? "Automatic updates are off." : !st.keys?.apify ? "Apify isn't connected, so streams and followers don't update." : `Streams and YouTube update daily, followers weekly${st.lastAt ? ` · last update ${shortDay(st.lastAt)}, ${clock(st.lastAt)}` : ""}`;
  return (
    <section className="sync-sources" data-sync-sources>
      <div className="sync-sec-head"><h3>Where the numbers come from</h3>
        {founder && d?.cost && <span className="nums-cost" data-nums-cost title="What the automatic numbers cost a month at this schedule">About {usd(d.cost.estMonthlyUsd)}/month</span>}</div>
      {err && !d ? <p className="hint err-text">Couldn't load the sources. <button className="inline-link" onClick={load}>Try again</button></p>
        : !d ? <p className="hint"><RefreshCw size={14} className="spin" /> Loading…</p>
        : <>
          <p className="hint" data-nums-status>{line}</p>
          <SourceNums d={d} founder={founder} canEdit={ctx.can("money")} onSaved={load} />
        </>}
      <div className="sync-sec-head"><h3>Monday digest</h3>
        <button type="button" className="inline-link" aria-expanded={digest} data-digest-toggle onClick={() => setDigest(!digest)}>{digest ? "Hide the preview" : "Preview this week's digest"} <ChevronDown size={14} aria-hidden="true" /></button></div>
      {digest && <DigestPreview />}
    </section>
  );
}
