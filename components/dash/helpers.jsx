import { useState, useEffect, useRef } from "react";
import { Disc3 } from "lucide-react";
import { evenSplit } from "../../lib/splits";
import { songGaps } from "../../lib/sheet-facts";
import { likelyDuplicates, plainTitle } from "../../lib/duplicates";
import { shareFixesOf, splitsToConfirm } from "./catalog-data";
import { fmt, splitTotal, useEscape } from "./ui";

/* staff: small shared helpers (days, numbers, each song's extra facts) ------------------------ */
const ago = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
export const shortDay = (iso) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
// a payment's day, with its year when it isn't this year's ("Dec 19, 2025" in a list of 2026 rows)
export const payDay = (iso) => (iso && new Date(iso).getFullYear() !== new Date().getFullYear()
  ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : shortDay(iso));
// a run of days, as short as it reads: "Sep 17 – 23", "Aug 27 – Sep 8" (with the year when it isn't this one)
export const dayRange = (from, to) => {
  const day = (iso) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  const a = day(from), b = day(to), yr = (d) => (d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : "");
  const md = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (a.toDateString() === b.toDateString()) return md(b) + yr(b);
  if (a.getFullYear() !== b.getFullYear()) return `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`;
  return `${md(a)} – ${a.getMonth() === b.getMonth() ? b.toLocaleDateString(undefined, { day: "numeric" }) : md(b)}${yr(b)}`;
};
// whole days from a date ("2026-10-14") to today, wherever this is read
export const daysSince = (iso) => Math.round((new Date().setHours(12, 0, 0, 0) - new Date(`${iso}T12:00:00`).getTime()) / 86400000);
export const signed = (n) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(Math.round(n)))}`;
export const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? "−" : "+";
  return a >= 1e6 ? `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : `${s}${a}`;
};

// POST /api/songs (lib/song-info.js): an ISRC typed or picked, "This isn't ours", "Not the same song"
export async function songsPost(body) {
  const res = await fetch("/api/songs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = res && await res.json().catch(() => null);
  if (!res?.ok) throw Object.assign(new Error(data?.error || "That didn't go through — check your connection and try again."), { data });
  return data;
}

// where an ISRC came from, in lib/isrc.js SOURCES' words (App.jsx can't import server code)
const ISRC_SOURCES = { "spotify-link": "the song's Spotify link", deezer: "Deezer", "deezer-artist": "the artist's Deezer page", musicbrainz: "MusicBrainz", manual: "typed in" };
// the finder's guesses for a song (any of its pages' ids), or []
export const isrcPicksOf = (info, ids) => ids.map((id) => info?.isrcCandidates?.[id]).find((x) => x?.length) || [];
// A row's ⋯ menu (rule 3: one button per row; the rest goes here). Placed on the screen itself like the
// Board's, so a list that scrolls can't cut it off; it follows its button and closes on a tap elsewhere.
export function RowMenu({ label, items }) {
  const [menu, setMenu] = useState(null);
  const box = useRef(null), dots = useRef(null);
  useEscape(() => setMenu(null), !!menu);
  const place = () => {
    const r = dots.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    const up = window.innerHeight - r.bottom < 24 + items.length * 40;
    return { right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) };
  };
  const isOpen = !!menu;
  useEffect(() => {
    if (!isOpen) return undefined;
    const follow = () => setMenu(place());
    const off = (e) => { if (!box.current?.contains(e.target)) setMenu(null); };
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow);
    document.addEventListener("mousedown", off); document.addEventListener("touchstart", off);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <span className="row-more" ref={box}>
      <button ref={dots} type="button" className="btn ghost sm row-dots" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setMenu(menu ? null : place())}>⋯</button>
      {menu && (
        <span className="arb-menu arb-menu-fixed row-menu" role="menu" style={menu}>
          {items.map((x) => (
            <button key={x.label} type="button" role="menuitem" className={x.className} title={x.title} disabled={x.disabled} {...(x.attrs || {})} onClick={() => { setMenu(null); x.onClick(); }}>{x.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

// The ISRC finder's guesses where it wasn't sure (up to 3, each with its cover, title, artist and where
// it came from): one tap saves that one
export function IsrcPicks({ list, busy, onPick }) {
  return (
    <span className="isrc-picks" data-isrc-picks>
      <span className="hint">Is it one of these?</span>
      {list.map((c) => (
        <button key={`${c.isrc}:${c.source}`} type="button" className="isrc-pick" data-isrc-pick={c.isrc} disabled={busy} onClick={() => onPick(c)} title={`${c.isrc} · from ${ISRC_SOURCES[c.source] || c.source}`}>
          <span className="isrc-pick-cover">{c.cover ? <img src={c.cover} alt="" loading="lazy" /> : <Disc3 size={14} />}</span>
          <span className="isrc-pick-main"><b>{c.title}</b><em>{c.artist}{c.artist ? " · " : ""}{ISRC_SOURCES[c.source] || c.source}</em></span>
        </button>
      ))}
    </span>
  );
}

// Spotify stream history for the songs this session can see ({ [placementId]: growth }, the automated
// numbers). failed = it couldn't load (retry tries again); the song cards just go without.
export function useGrowthState() {
  const [growth, setGrowth] = useState(null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => { setFailed(false); return fetch("/api/growth", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.growth) setGrowth(d.growth); else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    return () => { alive = false; };
  }, []);
  return { growth, failed, retry: () => loader.current?.() };
}
export const useGrowth = () => useGrowthState().growth;

// a song's all-time streams over time, as a small line (no axes: the numbers sit beside it)
export function Sparkline({ series, height = 56 }) {
  if (!series || series.length < 2) return null;
  const w = 300, h = height, pad = 3;
  const xs = series.map(([d]) => new Date(`${d}T00:00:00Z`).getTime()), ys = series.map(([, s]) => s);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (w - pad * 2);
  const py = (y) => h - pad - ((y - y0) / (y1 - y0 || 1)) * (h - pad * 2);
  const line = series.map((_, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(ys[i]).toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Streams from ${fmt(ys[0])} to ${fmt(ys[ys.length - 1])}`}>
      <path d={`${line}L${px(x1).toFixed(1)},${h}L${px(x0).toFixed(1)},${h}Z`} className="spark-fill" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// "+12K this week": this week's Spotify streams (the automated numbers), when there's a week of them
export function GrowthChip({ g }) {
  if (!g || g.thisWeek == null || !(g.thisWeek > 0)) return null;
  return <span className="grow-chip" title={`${fmt(g.thisWeek)} Spotify streams${g.weekOf ? `, ${dayRange(g.weekOf.from, g.weekOf.to)}` : " this week"}`}>{compact(g.thisWeek)} this week</span>;
}

// What needs a person, across the whole company: a short headline each (t), an optional detail line
// under it (d), and the one place it's fixed ({ tab, sub } for onGo). Pure, so Publishing can count
// its own share (area "roster"). songInfo = null while each song's facts load: only what the db
// alone shows, until then. Every task has an area for its colour: roster | money | ar | clickup | site.
// the sheet-tab To do's names: tabs the last sync didn't find, only clients with songs (a brand-new
// client with no tab yet has no numbers to miss). Website › Roster marks the same clients.
export const findTabClient = (db, n) => db.clients.find((x) => x.name === n || (x.sheetTabName || "").trim() === n);
export const noTabNames = (db, songInfo) => (songInfo?.missingTabs || []).filter((n) => { const c = findTabClient(db, n); return !c || db.placements.some((p) => p.clientId === c.id); });
// Songs to update (build G2): every song the pub sheet or the site is missing something for, from what the
// last sheet pull read (db.sheetFacts, lib/sheet-facts.js). A split alone doesn't list a song (Splits to
// confirm has those); on a listed song its split shows as one more chip. Biggest streams first.
export const GAP_WORDS = { share: "no writer share in the sheet", sheet: "not on the pub sheet", date: "no release date", link: "no link" };
export function songsToUpdate(db, songInfo) {
  const facts = db.sheetFacts || { songs: {}, clients: {} };
  // a card in a possible duplicate pair is left out until the merge card is answered: Update and Save on the
  // card that would be removed adds a second row for the song to the pub sheet, and then the pair is never asked about
  const held = dupeIds(db, songInfo);
  // (r7) a blank share on the sheet with 100% here is To do's own "Fill in 100%" row, not a gap here
  const fillIds = new Set(shareFixesOf(db).sheet.map((x) => x.p.id));
  const out = [];
  for (const p of db.placements) {
    if (held.has(p.id)) continue;
    const split = splitTotal(p.splits) === 100 ? "ok" : evenSplit(p.splits).status;
    const gaps = songGaps({ p, fact: facts.songs?.[p.id], tabRead: facts.clients?.[p.clientId] != null, split }).filter((x) => !(x.k === "share" && fillIds.has(p.id)));
    if (!gaps.some((x) => GAP_WORDS[x.k])) continue;
    // a split to confirm or review is Splits to confirm's (build I3): listed here only for the other gaps, with a pointer
    out.push({ p, client: (db.clients || []).find((c) => c.id === p.clientId) || null, gaps: gaps.filter((x) => GAP_WORDS[x.k]), splitSee: gaps.some((x) => !GAP_WORDS[x.k]) });
  }
  return out.sort((a, b) => (b.p.streams || 0) - (a.p.streams || 0));
}
// Two cards that look like the same song (build H1, lib/duplicates.js): only once each song's facts are in (the ISRCs
// and the pairs staff marked "Not the same song" come with it), and only for clients whose tab the last pull read
export function likelyDupes(db, songInfo) {
  if (!songInfo) return [];
  return likelyDuplicates(db.placements, { facts: db.sheetFacts || {}, isrcOf: (id) => songInfo.tracking?.[id]?.isrc || "", dismissed: songInfo.notDuplicates || [] })
    .map((x) => ({ ...x, client: (db.clients || []).find((c) => c.id === x.clientId) || null }));
}
// every card in a pair, both the kept one and the other: Songs to update and Splits to confirm leave them out
export const dupeIds = (db, songInfo) => new Set(likelyDupes(db, songInfo).flatMap((x) => [x.keep.id, x.drop.id]));
// "TRUST WHO (Stack!e)": the To do and Publishing's line name the song once, without its version tags
export const dupeName = (x) => `${plainTitle(x.keep.song) || "Untitled"} (${x.client?.name || "no client"})`;
export const dupeWords = (list) => (list.length === 1 ? `Possible duplicate: ${dupeName(list[0])}` : `${list.length} possible duplicate songs`);
// the To do's detail (build I3): the gaps that matter for money first (no writer share, not on the sheet),
// then a missing date or link counted once per song; short words so it stays one line on a laptop
const UPDATE_WORDS_MAX = 60;
function updateWords(list) {
  const n = (f) => list.filter((x) => x.gaps.some(f)).length;
  const share = n((g) => g.k === "share"), sheet = n((g) => g.k === "sheet"), dl = n((g) => g.k === "date" || g.k === "link");
  const parts = [share && `${share} no writer share`, sheet && `${sheet} not on the sheet`, dl && `${dl} no date or link`].filter(Boolean);
  let out = parts[0] || "";
  for (const x of parts.slice(1)) if (`${out} · ${x}`.length <= UPDATE_WORDS_MAX) out = `${out} · ${x}`; else break;
  return out;
}
export function dashTasks(db, songInfo) {
  // both groups of Splits to confirm, in plain words: the even default ready to confirm, and the ones to fix by hand
  const { assumed, look } = splitsToConfirm(db, songInfo);
  const nSplits = assumed.length + look.length;
  const splits = nSplits && {
    k: "splits", area: "roster", t: `${nSplits} song${nSplits === 1 ? "'s split needs" : "s' splits need"} confirming`,
    d: [assumed.length && `${assumed.length} assumed as an even split`, look.length && `${look.length} need${look.length === 1 ? "s" : ""} review`].filter(Boolean).join(" · "),
    tab: "catalog", sub: "splits", cta: "Review splits",
  };
  // one line for every song missing something on the sheet or the site (Publishing › Songs to update)
  const upd = songsToUpdate(db, songInfo);
  const update = upd.length > 0 && {
    k: "update", area: "roster", t: `${upd.length} song${upd.length === 1 ? " needs" : "s need"} updating`,
    d: updateWords(upd), tab: "catalog", sub: "update", cta: "Review",
  };
  const noTab = noTabNames(db, songInfo);
  const noTabOne = noTab.length === 1 ? findTabClient(db, noTab[0]) : null;
  const tabNames = noTab.length > 1 ? `${noTab.slice(0, -1).join(", ")} or ${noTab[noTab.length - 1]}` : noTab[0];
  if (!songInfo) return [splits, update].filter(Boolean);
  // one line for every pair of cards that look like the same song: Review opens the merge card
  const dupes = likelyDupes(db, songInfo);
  const dupe = dupes.length > 0 && {
    // r10 fix: one pair says what it's the same as ("Same as “Trust Who” on Stack!e's page")
    k: "dupes", area: "roster", t: dupeWords(dupes), d: dupes.length > 1 ? dupes.slice(0, 2).map(dupeName).join(" · ") : `Same as “${dupes[0].drop?.song || "another card"}” on ${dupes[0].client?.name ? `${dupes[0].client.name}'s` : "the same"} page`,
    tab: "catalog", sub: "dupes", cta: "Review",
  };
  return [
    dupe,
    splits,
    update,
    // the fix is each one's "Sheet tab name", which lives in Website › Roster
    // one client: its edit window opens on that field
    noTab.length && (noTabOne ? {
      k: "tabs", area: "roster", t: `${noTab[0]}'s numbers can't sync`,
      d: `The pub sheet has no tab called ${noTab[0]}. If theirs has another name, type it in.`,
      tab: "website", sub: `roster:${noTabOne.id}`, cta: `Set ${noTabOne.name}'s sheet tab`,
    } : {
      k: "tabs", area: "roster", t: noTab.length === 1 ? `${noTab[0]}'s numbers can't sync` : `${noTab.length} clients' numbers can't sync`,
      d: `The pub sheet has no tab called ${tabNames}. If ${noTab.length === 1 ? "it has another name, type it" : "theirs have other names, type them"} under Website › Roster › Sheet tab name.`,
      tab: "website", sub: "roster", cta: "Open the roster",
    }),
  ].filter(Boolean);
}

// true while a media query matches (false on the first paint, like the server's)
export function useMedia(q) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(q), f = () => setOn(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [q]);
  return on;
}

// A Dashboard card's body that scrolls inside the card (900px and up): data-more while there's more
// below, for the fade at its foot, and how many rows are out of sight, for ScrollFoot (a fade alone
// can land on blank padding, and macOS hides the scrollbar). Checked after every render (rows
// arriving), on scroll and on resize.
// (This week's "no weekly numbers yet" note isn't a row: it's never counted as one more)
// a writer's week-on-week % needs this many streams this week (lib/weekly.js TOP_MIN)
export const WEEK_PCT_MIN = 1000;
// phones get no scroll box inside the page: each list shows this many rows, then "Show N more"
const HOME_ROWS = 4;
const HomeMore = ({ n, open, onToggle }) => (n > 0 ? <button className="btn ghost sm home-more" onClick={onToggle}>{open ? "Show less" : `Show ${n} more`}</button> : null);
