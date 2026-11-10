import { useState, useEffect } from "react";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { dataPost } from "./chips";

// (2026-11-10, the owner: "stackie can show his like brief campaign stats across socials and spotify") the top of a
// roster artist's Clients page, staff only: Spotify streams this week and each platform's count with its change over
// the week, from the automated numbers (GET /api/data, lib/data/summary.js; every roster artist updates daily now).
// A count with no week behind it yet shows its change since the day before; one with no link says so.
const URL = "/api/data";
const compact = (n) => (n == null ? "—" : Math.abs(n) >= 1e4 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : Math.round(n).toLocaleString("en-US"));
const pct = (f) => (f == null || !Number.isFinite(f) ? null : `${f >= 0 ? "▲" : "▼"} ${Math.abs(f * 100).toFixed(1)}%`);
const TILES = [
  ["streams", "Spotify streams", "this week"],
  ["spotify_monthly_listeners", "Monthly listeners"],
  ["spotify_followers", "Spotify followers"],
  ["tiktok_followers", "TikTok followers"],
  ["instagram_followers", "Instagram followers"],
  ["youtube_subscribers", "YouTube subscribers"],
];

// the artist's numbers (a:<clientId>) and a reload, shared by the card and the More menu's Stop tracking
export function useArtistNumbers(clientId) {
  const [d, setD] = useState(() => (clientId ? peekJson(URL) || null : null));
  const [err, setErr] = useState(false);
  const load = () => swrJson(URL, (j) => { setD(j); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { if (clientId) load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps (none: a client's portal)
  const artist = (d?.artists || []).find((a) => a.clientId === clientId) || null;
  return { artist, loaded: !!d, err, reload: load };
}
export const setTracking = (clientId, on) => dataPost({ action: "mode", entityId: `a:${clientId}`, mode: on ? "auto" : "off", days: null });

function Tile({ k, label, unit, a }) {
  if (k === "streams") {
    const s = a?.streams;
    const v = s?.thisWeek ?? null;
    return (
      <div className="cat-stat as-tile" data-as={k}>
        <span className="cat-stat-label">{label}{unit && <span className="cat-stat-note"> ({unit})</span>}</span>
        <span className="cat-stat-val">{v == null ? "—" : compact(v)}</span>
        <span className="as-chg" data-dir={s?.pct > 0 ? "up" : s?.pct < 0 ? "down" : undefined}>{v == null ? "A week of daily numbers first" : pct(s.pct) ? `${pct(s.pct)} vs last week` : "vs last week: next week"}</span>
      </div>
    );
  }
  const m = a?.metrics?.[k];
  const linked = !!a?.links?.[k.split("_")[0]];
  const chg = m?.growthPct != null ? `${pct(m.growthPct)} this week` : m?.daily != null && m.daily !== 0 ? `${m.daily > 0 ? "+" : "−"}${compact(Math.abs(m.daily))} since yesterday` : null;
  return (
    <div className="cat-stat as-tile" data-as={k}>
      <span className="cat-stat-label">{label}</span>
      <span className="cat-stat-val">{m?.latest == null ? "—" : `${m.approx ? "~" : ""}${compact(m.latest)}`}</span>
      <span className="as-chg" data-dir={m?.growthPct > 0 || (m?.growthPct == null && m?.daily > 0) ? "up" : m?.growthPct < 0 || (m?.growthPct == null && m?.daily < 0) ? "down" : undefined}>
        {m?.latest == null ? (linked ? "First reading soon" : "No link on file") : chg || "No change yet"}
      </span>
    </div>
  );
}

export function ArtistStats({ nums }) {
  const { artist: a, loaded, err, reload } = nums;
  if (err && !loaded) return <p className="hint as-card" data-artist-stats="error">Couldn't load this artist's numbers. <button className="inline-link" onClick={reload}>Try again</button></p>;
  if (!loaded) return null;
  const day = [a?.streams?.day, ...Object.values(a?.metrics || {}).map((m) => m.day)].filter(Boolean).sort().pop();
  return (
    <div className="cat-summary as-card" data-artist-stats>
      <div className="as-head">
        <h3>Campaign</h3>
        <span className="hint">{a?.mode === "off" ? "Tracking is stopped for this artist (More ▾ to start it again)" : `Updates daily${day ? ` · ${new Date(`${String(day).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`}</span>
      </div>
      <div className="cat-summary-grid as-grid">{TILES.map(([k, label, unit]) => <Tile key={k} k={k} label={label} unit={unit} a={a} />)}</div>
    </div>
  );
}
