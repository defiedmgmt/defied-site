import { useState, useEffect } from "react";
import { ChevronDown, RefreshCw, AlertTriangle, TrendingUp, ChevronRight } from "lucide-react";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { clock } from "./ar";
import { RowMenu, Sparkline, compact, shortDay } from "./helpers";
import { fmt } from "./ui";

/* Numbers (list B #4): the automated numbers ------------------------------ */
// Every roster artist (and watchlist artist) with their numbers, each labelled by platform ("Spotify
// streams, global"), with this week against last week, a small chart, and "last updated <date>" when its
// source hasn't refreshed it on time (the last good number stays). Tap an artist for their songs and
// campaign mode (daily updates while we push them). Sounds: TikTok sounds we track by link. Sources &
// cost: how often each source runs, which scraper it uses, its monthly budget and what a month costs.
export const dataPost = async (body) => {
  const r = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't save that — try again.");
  return j;
};
const usd = (v) => `$${(Number(v) || 0).toFixed(Number(v) >= 10 ? 0 : 2)}`;
const big = (n) => (n == null ? "—" : Math.abs(n) >= 1e4 ? compact(n).replace(/^\+/, "") : fmt(n));
const pctWord = (p) => (p == null ? null : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 100))}%`);
function NumTile({ m, label, sub, k }) {
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
export function NumbersPage({ ctx }) {
  const [d, setD] = useState(() => peekJson("/api/data") || null), [err, setErr] = useState(false);
  const [view, setView] = useState("artists"), [open, setOpen] = useState(null);
  const load = () => swrJson("/api/data", (j) => { setD(j); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { load(); }, []);
  if (err && !d) return <div className="nums"><div className="admin-head"><h2>Numbers</h2></div><p className="hint err-text">Couldn't load the numbers. <button className="inline-link" onClick={load}>Try again</button></p></div>;
  if (!d) return <div className="nums"><div className="admin-head"><h2>Numbers</h2></div><p className="hint"><RefreshCw size={14} className="spin" /> Loading…</p></div>;
  const st = d.state;
  const line = !st.refreshOn ? "Automatic updates are off." : !st.keys?.apify ? "Apify isn't connected, so streams and followers don't update." : `Streams and YouTube update daily, followers weekly${st.lastAt ? ` · last update ${shortDay(st.lastAt)}, ${clock(st.lastAt)}` : ""}`;
  return (
    <div className="nums" data-numbers>
      <div className="admin-head"><h2>Numbers</h2><span className="home-src" data-nums-status>{line}</span>
        <button type="button" className="nums-cost" data-nums-cost onClick={() => setView("sources")} title="What the automatic numbers cost a month at this schedule">About {usd(d.cost.estMonthlyUsd)}/month</button></div>
      {d.spikes.length > 0 && (
        <div className="nums-spikes" data-nums-spikes>
          {d.spikes.slice(0, 4).map((s, i) => <span key={i} className="nums-spike"><TrendingUp size={13} /> <b>{s.name}</b> {s.text}</span>)}
        </div>
      )}
      <span className="gainer-tabs nums-views" role="tablist" aria-label="Numbers">
        {[["artists", "Artists"], ["sounds", "Sounds"], ["sources", "Sources & cost"], ["digest", "Monday digest"]].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} data-nums-view={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{l}</button>)}
      </span>
      {view === "artists" && (!d.artists.length ? <div className="admin-empty">No numbers yet. They start with the first daily update.</div> : (
        <div className="nums-list">{d.artists.map((a) => <ArtistNums key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onSaved={load} />)}</div>
      ))}
      {view === "sounds" && <SoundNums sounds={d.sounds} onSaved={load} />}
      {view === "sources" && <SourceNums d={d} canEdit={ctx.can("money")} onSaved={load} />}
      {view === "digest" && <DigestPreview />}
    </div>
  );
}

// List B #9: "Preview this week's digest": exactly what Monday's team digest and this account's own
// digest would say (GET /api/digest), for the sections this account may see. A Founder can look at
// anyone's personal digest, and sees who gets one and what this week's run did.
const pctSigned = (p) => (p == null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`);
function DigestItem({ k, it }) {
  const main = k === "radar" ? `${it.title}${it.artist ? ` — ${it.artist}` : ""}` : it.name || it.title || "";
  const nums = k === "roster"
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
function DigestPreview() {
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
      <DigestBlock d={d.team} label="Team digest (the team's ClickUp channel)" />
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
function ModeSwitch({ id, mode, onSaved, what = "artist" }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const set = async (m) => { setBusy(true); setErr(null); try { await dataPost({ action: "mode", entityId: id, mode: m, days: m === "campaign" ? 30 : null }); await onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="nums-mode" data-nums-mode={mode || "auto"}>
      <label className="nums-switch"><input type="checkbox" checked={mode === "campaign"} disabled={busy || mode === "off"} onChange={(e) => set(e.target.checked ? "campaign" : "auto")} /> Campaign mode: everything about this {what} updates daily for 30 days</label>
      {mode === "off" ? <button type="button" className="inline-link" disabled={busy} onClick={() => set("auto")}>Start updating again</button>
        : <button type="button" className="inline-link nums-off" disabled={busy} onClick={() => set("off")}>Stop updating</button>}
      {err && <span className="hint err-text">{err}</span>}
    </div>
  );
}
function ArtistNums({ a, open, onToggle, onSaved }) {
  const m = a.metrics;
  const [all, setAll] = useState(false);
  const tiles = [
    (a.streams || a.songs.length > 0) && <NumTile key="st" k="streams" label="Spotify streams, global" m={a.streams} sub={a.streams?.songs ? `${a.streams.songs} song${a.streams.songs === 1 ? "" : "s"}` : null} />,
    (m.spotify_monthly_listeners || a.links.spotify) && <NumTile key="ml" k="listeners" label="Spotify monthly listeners" m={m.spotify_monthly_listeners} sub={m.spotify_followers ? `${big(m.spotify_followers.latest)} followers` : null} />,
    (m.instagram_followers || a.links.instagram) && <NumTile key="ig" k="instagram" label="Instagram followers" m={m.instagram_followers} />,
    (m.tiktok_followers || a.links.tiktok) && <NumTile key="tt" k="tiktok" label="TikTok followers" m={m.tiktok_followers} />,
    (m.youtube_subscribers || a.links.youtube) && <NumTile key="yt" k="youtube" label="YouTube subscribers" m={m.youtube_subscribers} sub={m.youtube_views ? `${big(m.youtube_views.latest)} views` : null} />,
  ].filter(Boolean);
  const songs = all ? a.songs : a.songs.slice(0, 12);
  return (
    <div className={`nums-card${open ? " open" : ""}`} data-nums-artist={a.id}>
      <button type="button" className="nums-head" aria-expanded={open} onClick={onToggle}>
        {a.image ? <img className="nums-av" src={a.image} alt="" loading="lazy" /> : <span className="nums-av" aria-hidden="true">{(a.name || "?").slice(0, 1)}</span>}
        <span className="nums-name">{a.name}</span>
        {a.watchlist && <span className="nums-tag">Watchlist</span>}
        {a.mode === "campaign" && <span className="nums-tag hot">Campaign · daily</span>}
        {a.mode === "off" && <span className="nums-tag">Not updating</span>}
        <ChevronDown size={16} className="nums-chev" aria-hidden="true" />
      </button>
      <div className="nums-tiles">{tiles.length ? tiles : <span className="hint">No links to read numbers from yet. Add their Spotify, Instagram, TikTok or YouTube in Site › Roster.</span>}</div>
      {/* list B #3: what Luminate last had for them, all platforms, kept as history (read only) */}
      {a.lum?.atd != null && <p className="nums-lum" data-nums-lum>Luminate, all platforms: {fmt(a.lum.atd)} all-time streams on {shortDay(a.lum.on)}{a.lum.songs ? ` (${a.lum.songs} song${a.lum.songs === 1 ? "" : "s"})` : ""}{a.lum.week != null ? ` · ${fmt(a.lum.week)} that week` : ""}</p>}
      {open && (
        <div className="nums-more" data-nums-more>
          <ModeSwitch id={a.id} mode={a.mode} onSaved={onSaved} />
          {a.songs.length > 0 && (
            <div className="nums-songs" data-nums-songs>
              <div className="nums-song nums-song-hd"><span>Song</span><span>Spotify streams, global</span><span>Yesterday</span><span>This week</span><span>vs last week</span><span title="Luminate's last all-time streams, all platforms (history)">Luminate, all-time</span></div>
              {songs.map((s) => (
                <div key={s.id} className="nums-song" data-song={s.id}>
                  <span className="nums-song-t">{s.name}{s.isNew && <span className="nums-tag hot">New</span>}<em>{s.artist}</em></span>
                  <span data-l="All-time" title={s.under1k ? "Spotify shows no count under 1,000 plays" : undefined}>{s.streams ? big(s.streams.latest) : s.under1k ? "Under 1K" : "—"}{s.streams?.stale && <em className="nums-when"> last updated {shortDay(s.streams.day)}</em>}</span>
                  <span data-l="Yesterday">{s.streams?.daily != null ? compact(s.streams.daily) : "—"}</span>
                  <span data-l="This week">{s.streams?.thisWeek != null ? compact(s.streams.thisWeek) : "—"}</span>
                  <span data-l="vs last week" className={s.streams?.pct == null ? "" : s.streams.pct >= 0 ? "pos" : "neg"}>{pctWord(s.streams?.pct) || "—"}</span>
                  <span data-l="Luminate, all-time" className="nums-song-lum" title={s.lum ? `Luminate, all platforms, ${shortDay(s.lum.on)}` : undefined}>{s.lum?.atd != null ? big(s.lum.atd) : "—"}</span>
                </div>
              ))}
              {a.songs.length > 12 && <button type="button" className="inline-link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${a.songs.length} songs`}</button>}
              {!a.songs.some((s) => s.streams?.thisWeek != null) && <p className="hint">Weekly changes show once there are two weeks of numbers.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function SoundNums({ sounds, onSaved }) {
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
function SourceNums({ d, canEdit, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(d.sources.map((s) => [s.key, { schedule: s.schedule, adapter: s.adapter, softCapUsd: String(s.softCapUsd) }])));
  const [total, setTotal] = useState(String(d.cost.totalCapUsd));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const set = (k, p) => setF((x) => ({ ...x, [k]: { ...x[k], ...p } }));
  const save = async () => { setBusy(true); setMsg(null); try { await dataPost({ action: "sources", sources: f, totalCapUsd: total }); setMsg({ ok: "Saved." }); await onSaved(); } catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); } };
  const acct = d.cost.account;
  const month = new Date().toLocaleDateString(undefined, { month: "long" });
  return (
    <div className="nums-src" data-nums-sources>
      <p className="nums-costline" data-costline>About <b>{usd(d.cost.estMonthlyUsd)} a month</b> at this schedule · {usd(d.cost.spentUsd)} spent in {month}{acct ? ` · Apify: ${usd(acct.usageUsd)} of its ${usd(acct.limitUsd)} limit used` : ""}</p>
      {d.sources.map((s) => (
        <div key={s.key} className="nums-srow" data-source={s.key}>
          <div className="nums-srow-t"><b>{s.label}</b><span className="hint">{s.tracked} tracked{s.campaign ? ` · ${s.campaign} in campaign mode` : ""} · about {usd(s.estMonthlyUsd)}/month{s.paid ? ` · ${usd(s.spentUsd)} this month` : " · free"}</span>
            <span className={`hint${s.last?.status === "failed" ? " err-text" : ""}`} data-last>{s.skipped ? `Skipped ${shortDay(s.skipped.at)}: ${s.skipped.why}` : s.last ? `${s.last.status === "failed" ? "Failed" : s.last.status === "started" ? "Running since" : "Last run"} ${shortDay(s.last.at)}${s.last.error ? `: ${s.last.error}` : ""}` : "Not run yet"}</span></div>
          {canEdit ? (
            <div className="nums-srow-f">
              {s.key !== "spotify_catalog" && <select aria-label="How often" value={f[s.key].schedule} onChange={(e) => set(s.key, { schedule: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>}
              {s.adapters.length > 1 && <select aria-label="Scraper" value={f[s.key].adapter} onChange={(e) => set(s.key, { adapter: e.target.value })}>{s.adapters.map((a) => <option key={a.id} value={a.id}>{a.actor}</option>)}</select>}
              {s.paid && <label className="nums-cap">Budget $<input type="number" min="0" max="19" step="0.5" value={f[s.key].softCapUsd} onChange={(e) => set(s.key, { softCapUsd: e.target.value })} />/mo</label>}
            </div>
          ) : <div className="nums-srow-f hint">{s.schedule === "daily" ? "Daily" : "Weekly"} · {s.adapters.find((a) => a.id === s.adapter)?.actor}{s.paid ? ` · budget ${usd(s.softCapUsd)}/mo` : ""}</div>}
        </div>
      ))}
      {canEdit ? (
        <div className="nums-save"><label className="nums-cap">All sources together: $<input type="number" min="0" max="19" step="0.5" value={total} onChange={(e) => setTotal(e.target.value)} />/month</label>
          <button className="btn sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {msg && <span className={`hint${msg.err ? " err-text" : ""}`} role="status">{msg.err || msg.ok}</span>}</div>
      ) : <p className="hint">Changing schedules and budgets needs Money access.</p>}
      <p className="hint">Apify's own hard limit stops every run at the plan's cap. A run that would go past this month's budget waits until next month.</p>
    </div>
  );
}
// Home: spikes and new releases from the automated numbers, and what they cost a month. Nothing to say: nothing shown.
export function HomeNumbers({ onGo }) {
  const [d, setD] = useState(() => peekJson("/api/data?home=1") || null);
  useEffect(() => { swrJson("/api/data?home=1", setD).catch(() => {}); }, []);
  if (!d || (!d.spikes.length && !d.newReleases.length)) return null;
  return (
    <div className="home-card nums-home" data-home-numbers>
      <div className="attn-head"><TrendingUp size={15} /> Spikes and new releases
        <button type="button" className="inline-link home-all" onClick={() => onGo("numbers")}>Numbers · about {usd(d.cost.estMonthlyUsd)}/month ›</button></div>
      {d.spikes.map((s, i) => <p key={`s${i}`} className="todo-line" data-spike><b>{s.name}</b>&nbsp;{s.text}</p>)}
      {d.newReleases.map((r, i) => <p key={`r${i}`} className="todo-line" data-new-release><b>{r.artist}</b>&nbsp;released “{r.name}” ({shortDay(r.releaseDate)}), picked up for tracking</p>)}
    </div>
  );
}

// A dashboard tab's one link to its to-dos: "3 to do ›", opening To do on that area (none: nothing shown)
export function TodoChip({ n, area, onGo }) {
  if (!n) return null;
  return <button type="button" className="todo-chip" data-area={area} data-todo-chip={area} onClick={() => onGo("todo", area)}>{n} to do <ChevronRight size={14} aria-hidden="true" /></button>;
}
