import { useMemo, useState } from "react";
import { RefreshCw, CheckCircle2, Search } from "lucide-react";
import { CardTable } from "../ui/responsive";
import { songsWithoutIsrc } from "./isrc-data";
import { IsrcPicks, songsPost, useMedia } from "./helpers";
import { fmt } from "./ui";
import { ExtLink } from "../shared/ui";

// The ISRC finder (round 10: the screen back, from missing-audit L2; r11: it opens inside To do, the row "N songs
// have no ISRC · Find them", /dashboard/todo/isrc, and no longer has a Publishing tab). Every pub sheet song
// with no ISRC yet, once even when two clients' pages have it: the finder's guesses to tap (cover, artists and
// release date), or the ISRC typed in (with IFPI's free search a tap away). "Find ISRCs" asks the finder
// (/api/songs findIsrcs: Spotify's search first, then the song's Spotify link, Deezer, MusicBrainz) eight songs
// at a time; a sure answer is saved at once, a maybe comes back as guesses. Saving sets the ISRC on every page
// the song is on.
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const clean = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const IFPI = "https://isrcsearch.ifpi.org/";

export { songsWithoutIsrc } from "./isrc-data";

export function IsrcFinder({ db, songInfo, reloadSongInfo }) {
  const name = useMemo(() => new Map((db.clients || []).map((c) => [c.id, c.name])), [db.clients]);
  const all = useMemo(() => songsWithoutIsrc(db, songInfo), [db, songInfo]);
  const [res, setRes] = useState({}); // key -> { isrc } | { notFound } | { error } | { candidates }
  const [typed, setTyped] = useState({});
  const [typing, setTyping] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // "find" | a song's key
  const [note, setNote] = useState(null);
  const [sort, setSort] = useState({ col: "client", dir: 1 });
  const [kept, setKept] = useState({}); // the songs saved on this visit: they stay on the list, ticked
  const who = (g) => g.clientIds.map((id) => name.get(id)).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(", ");
  // a song saved on this visit stays on the list with its tick (the song facts read again drop it from `all`)
  const rows = useMemo(() => {
    const k = (g) => (sort.col === "song" ? g.song : sort.col === "artist" ? g.artist : who(g) || g.artist).toLowerCase();
    const list = [...all, ...Object.values(kept).filter((g) => !all.some((x) => x.key === g.key))];
    return list.sort((a, b) => sort.dir * k(a).localeCompare(k(b)) || a.song.localeCompare(b.song));
  }, [all, kept, sort, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = rows.filter((g) => !res[g.key]?.isrc);
  // r11 fix: on a phone the first 20 (136 cards were about 25,000px), "Show more" for the next 20
  const phone = useMedia("(max-width: 639px)");
  const [limit, setLimit] = useState(20);
  const shownRows = phone ? rows.slice(0, limit) : rows;
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: -s.dir } : { col, dir: 1 }));

  const find = async () => {
    setBusy("find"); setNote(null);
    let left = open.filter((g) => !res[g.key]?.notFound);
    try {
      for (let pass = 0; left.length && pass < 8; pass++) {
        const part = left.slice(0, 8);
        const { results } = await songsPost({ action: "findIsrcs", groups: part.map((g) => g.ids) });
        setRes((r) => { const n = { ...r }; for (const g of part) if (results[g.ids[0]] && !results[g.ids[0]].later) n[g.key] = results[g.ids[0]]; return n; });
        setKept((k) => { const n = { ...k }; for (const g of part) if (results[g.ids[0]]?.isrc) n[g.key] = g; return n; });
        left = left.filter((g, i) => i >= 8 || results[g.ids[0]]?.later);
      }
      await reloadSongInfo?.();
    } catch (e) { setNote(e.message); }
    finally { setBusy(null); }
  };
  const save = async (g, isrc, source = null) => {
    setBusy(g.key); setNote(null);
    try {
      await songsPost(source ? { action: "pickIsrc", placementIds: g.ids, isrc, source } : { action: "setIsrc", placementIds: g.ids, isrc });
      setRes((r) => ({ ...r, [g.key]: { isrc } }));
      setKept((k) => ({ ...k, [g.key]: g }));
      reloadSongInfo?.();
    } catch (e) { setNote(e.message); }
    finally { setBusy(null); }
  };

  const cell = (g) => {
    const r = res[g.key] || {};
    if (r.isrc) return <span className="isrc-done" data-isrc-done><CheckCircle2 size={14} /> <code>{r.isrc}</code></span>;
    const picks = r.candidates?.length ? r.candidates : g.picks;
    if (picks.length && !typing.has(g.key)) return (
      <span className="isrc-cell">
        <IsrcPicks list={picks} busy={!!busy} onPick={(c) => save(g, c.isrc, c.source)} />
        <button type="button" className="inline-link" data-isrc-type onClick={() => setTyping((s) => new Set([...s, g.key]))}>None of these: type it</button>
      </span>
    );
    const v = clean(typed[g.key]);
    const bad = v.length >= 12 && !ISRC_RE.test(v);
    return (
      <span className="isrc-cell">
        <span className="isrc-in">
          <input value={typed[g.key] ?? ""} placeholder="Type the ISRC" aria-label={`ISRC for ${g.song || "this song"}`} data-isrc-input maxLength={15}
            onChange={(e) => setTyped((t) => ({ ...t, [g.key]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && ISRC_RE.test(v) && save(g, v)} />
          <button type="button" className="btn ghost sm" data-isrc-save disabled={!ISRC_RE.test(v) || !!busy} onClick={() => save(g, v)}>{busy === g.key ? "Saving…" : "Save"}</button>
        </span>
        {r.notFound ? <em className="hint">The finder found nothing.</em> : r.error ? <em className="hint err-text">{r.error}</em> : null}
        {bad && <em className="hint err-text">An ISRC is 12 letters and numbers, like USUM72506269.</em>}
      </span>
    );
  };
  const cols = [
    { id: "song", label: "Song", render: (g) => <span className="isrc-song"><b>{g.song || "Untitled"}</b>{g.link && <ExtLink className="inline-link" href={g.link}>Spotify ↗</ExtLink>}</span> },
    { id: "artist", label: "Artist", render: (g) => g.artist || "—" },
    { id: "client", label: "Client", render: (g) => who(g) || "—" },
    { id: "isrc", label: "ISRC", render: cell, className: "isrc-col" },
  ];
  return (
    <div className="isrc-page" data-isrc-page>
      <div className="isrc-head">
        <p className={`isrc-count${open.length ? " isrc-count-sr" : ""}`} data-isrc-count={open.length}>{open.length ? <><b>{fmt(open.length)}</b> song{open.length === 1 ? "" : "s"} with no ISRC</> : <><CheckCircle2 size={15} /> Every song has its ISRC.</>}</p>
        <span className="isrc-acts">
          {open.length > 0 && <button type="button" className="btn sm" data-find-isrcs disabled={!!busy} onClick={find}>{busy === "find" ? <><RefreshCw size={14} className="spin" /> Looking…</> : <><Search size={14} /> Find ISRCs</>}</button>}
          <ExtLink className="btn ghost sm" href={IFPI}>IFPI search ↗</ExtLink>
        </span>
      </div>
      <p className="hint">The finder searches Spotify first, then Deezer and MusicBrainz. Tap the right song, or type the ISRC.</p>
      {note && <p className="hint err-text" role="alert">{note}</p>}
      {rows.length > 0 && <CardTable cols={cols} rows={shownRows} rowKey={(g) => g.key} sort={sort} onSort={onSort} className="isrc-table" data-isrc-table="" />}
      {phone && rows.length > shownRows.length && <button type="button" className="btn ghost sm isrc-more" data-isrc-more onClick={() => setLimit((n) => n + 20)}>Show {Math.min(20, rows.length - shownRows.length)} more ({fmt(rows.length - shownRows.length)} left)</button>}
    </div>
  );
}
