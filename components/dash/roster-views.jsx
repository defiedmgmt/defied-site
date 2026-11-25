import { useEffect, useMemo, useState } from "react";
import { CardTable, PHONE_Q } from "../ui/responsive";
import { peekJson, swrJson } from "../ui/fetch-cache";
import { splitsToConfirm } from "./catalog-data";
import { streamsAsOf, fmt } from "./ui";
import { useMedia } from "./helpers";
import { Photo, thumb } from "../shared/ui";
import { FILTERS, catalogRows, filterCounts, filterRows, newReleases, searchRows, sortRows, summary, todayNY } from "../../lib/roster-catalog";

// Roster › Catalog (2026-11-23, the owner: a catalog and a release desk under the roster, "i dont wanna change it up too bad"; 2026-11-24: "maybe we dont need releases if we have catalog yk", so the
// Releases pill is gone and its dates are the "New releases" strip on top of Catalog): the same songs as the Clients pages, every client's in one list. Read only: a click opens the song in
// its client's own page and editor (CatalogAdmin's openFix); nothing here saves anything.
// The rows come from the dashboard's own data (db.clients, db.placements: an account limited to its own artists already has only theirs), the rules are lib/roster-catalog.js's.
const TRACKING_URL = "/api/roster-catalog";
const PHONE_ROWS = 25; // a phone shows this many cards, then "Show more" (as the ISRC finder does: 136 cards were 25,000px)

// "Oct 29, 2026" from a day ("YYYY-MM-DD")
const dayWords = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// the songs as one-per-row rows. Each song's ISRC and "Not on streaming" are the dashboard's own copy (GET /api/songs, which every account but one limited to its own artists
// has) or, for that one, GET /api/roster-catalog's. tracking null: not known yet, so no song is said to lack an ISRC or to be off streaming
function useRosterRows(db, songInfo) {
  const own = songInfo?.tracking || null;
  const [got, setGot] = useState(() => peekJson(TRACKING_URL)?.tracking || null);
  const [failed, setFailed] = useState(false);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (own) return undefined;
    let alive = true;
    setFailed(false);
    swrJson(TRACKING_URL, (j) => alive && setGot(j.tracking), { keep: (j) => !!j?.tracking && typeof j.tracking === "object" })
      .then((j) => { if (alive && !(j?.tracking && typeof j.tracking === "object")) setFailed(true); }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [!!own, again]); // eslint-disable-line react-hooks/exhaustive-deps
  const tracking = own || got;
  // the songs whose split is to confirm: the list To do and the client chips use (components/dash/catalog-data.js)
  const confirmIds = useMemo(() => new Set(splitsToConfirm(db, songInfo).all.map((x) => x.p.id)), [db, songInfo]);
  const rows = useMemo(() => catalogRows({ clients: db.clients, placements: db.placements, tracking, confirmIds }), [db.clients, db.placements, tracking, confirmIds]);
  return { rows, loading: !tracking && !failed, failed, retry: () => setAgain((n) => n + 1) };
}

// one song's open button: a real button (the keyboard's way in; a click anywhere on the row does the same through the table's onRow, so this has no handler of its own)
const OpenSong = ({ r }) => (
  <button type="button" className="rl-open" data-rl-open={r.open} title={`Opens ${r.openClient}'s page${r.clients.length > 1 ? `. Also on ${r.clients.filter((c) => c.name !== r.openClient).map((c) => c.name).join(", ")}.` : "."}`}>{r.title}</button>
);
const Clients = ({ r }) => r.clients.map((c) => c.name).join(", ") || "—";
// a song's cover: the link it holds (placements.cover), through the resizer the client photos use; with none, the letter the app's own placeholder draws for a client with no photo (.avatar-ph)
const initialOf = (title) => (/[\p{L}\p{N}]/u.exec(String(title ?? ""))?.[0] || "?").toUpperCase();
const Cover = ({ r, w }) => (r.cover ? <Photo src={thumb(r.cover, w)} alt="" /> : <span className="avatar avatar-ph" aria-hidden="true">{initialOf(r.title)}</span>);
// the app's own gap chips: a gap in the warning colour, "Split to confirm" and "Not on streaming" neutral (nothing is wrong with them)
const Chips = ({ r }) => (r.chips.length ? <span className="upd-gaps">{r.chips.map((c) => <span key={c.k} className={`upd-gap${c.k === "off" || c.k === "confirm" ? " upd-off" : ""}`} data-gap={c.k}>{c.label}</span>)}</span> : null);

function Waiting({ loading, failed, retry }) {
  if (loading) return <p className="home-muted" aria-busy="true" data-rl-wait>Loading…</p>;
  if (failed) return <p className="hint err-text" role="alert" data-rl-failed>Couldn't read which songs have an ISRC or aren't on streaming just now, so those two aren't shown. <button type="button" className="inline-link" onClick={retry}>Try again</button></p>;
  return null;
}

// "New releases", on top of Catalog: the songs coming up (a release date after today, tagged "Coming up") first, the soonest first, then the ones out in the last 30 days, the newest first
// (lib/roster-catalog.js newReleases), as cover cards in a row that scrolls sideways inside itself. A card opens the song in its client's page and editor, as the table's rows do.
function NewReleases({ rows, onOpen }) {
  const today = useMemo(() => todayNY(), []);
  const list = useMemo(() => newReleases(rows, today), [rows, today]);
  const soon = list.filter((r) => r.coming).length, out = list.length - soon;
  const counts = [soon > 0 && `${fmt(soon)} coming up`, out > 0 && `${fmt(out)} out in the last 30 days`].filter(Boolean).join(" · ");
  return (
    <section className="nr-new" data-rl-new aria-labelledby="nr-new-h">
      <div className="fix-head"><h3 id="nr-new-h">New releases</h3>{counts && <span className="hint" data-rl-new-count>{counts}</span>}</div>
      {list.length === 0
        ? <p className="hint" data-rl-empty="new">No song is coming up, and none came out in the last 30 days.</p>
        : <ul className="nr-strip" data-m-scroll>
          {list.map((r) => (
            <li key={r.key}>
              <button type="button" className="song-card nr-card" data-nr-card={r.open} data-nr-coming={r.coming ? "" : undefined} title={`Opens ${r.openClient}'s page`} onClick={() => onOpen(r)}>
                <span className="song-cover"><Cover r={r} w={384} />{r.coming && <span className="nr-tag">Coming up</span>}</span>
                <span className="song-info"><strong>{r.title}</strong><span>{r.artist || "—"}</span><em>{dayWords(r.releaseDate)}</em></span>
              </button>
            </li>
          ))}
        </ul>}
    </section>
  );
}

export function RosterCatalog({ db, songInfo, onOpen }) {
  const { rows, loading, failed, retry } = useRosterRows(db, songInfo);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [by, setBy] = useState("streams");
  const found = useMemo(() => searchRows(rows, q), [rows, q]);
  const counts = useMemo(() => filterCounts(found), [found]);
  const shown = useMemo(() => sortRows(filterRows(found, filter), by), [found, filter, by]);
  const sum = useMemo(() => summary(shown), [shown]);
  const phone = useMedia(PHONE_Q); // the cards' own query (mobile.css): a phone held sideways too
  const [limit, setLimit] = useState(PHONE_ROWS);
  useEffect(() => { setLimit(PHONE_ROWS); }, [q, filter, by]);
  const list = phone ? shown.slice(0, limit) : shown;
  // the day the streams are from, as the portal and the share card say it (db.streamsOn); else the day the site last read the pub sheet
  const asOf = db.streamsOn ? `Streams as of ${dayWords(db.streamsOn)}` : db.sheetSync?.lastSyncedAt ? streamsAsOf({ pulledAt: db.sheetSync.lastSyncedAt }) : "";
  const several = shown.some((r) => r.clients.length > 1);
  const cols = [
    { id: "song", label: "Song", className: "rl-song", render: (r) => <span className="nr-song"><span className="nr-thumb"><Cover r={r} w={96} /></span><OpenSong r={r} /></span> },
    { id: "artist", label: "Artist", render: (r) => r.artist || "—" },
    { id: "client", label: "Client", className: "rl-client", render: (r) => <Clients r={r} /> },
    { id: "released", label: "Released", className: "rl-day", render: (r) => (r.releaseDate ? dayWords(r.releaseDate) : "—") },
    { id: "streams", label: "Streams", className: "rl-n", render: (r) => (r.streams > 0 ? fmt(r.streams) : "—") },
    { id: "status", label: "Status", className: "rl-chips", render: (r) => <Chips r={r} /> },
  ];
  return (
    <div className="rl-page" data-rl-page="songs">
      {rows.length > 0 && <NewReleases rows={rows} onOpen={onOpen} />}
      <div className="emp-big" data-rl-total>
        <span className="emp-big-n" data-rl-streams={sum.streams}>{fmt(sum.streams)}</span>
        <span className="emp-big-of" data-rl-songs={sum.songs}>{sum.streams === 1 ? "stream" : "streams"} · {fmt(sum.songs)} {sum.songs === 1 ? "song" : "songs"}</span>
      </div>
      <p className="hint cat-asof" data-rl-asof>
        {[asOf, sum.noStreams > 0 && `${fmt(sum.noStreams)} ${sum.noStreams === 1 ? "song" : "songs"} not on Luminate yet, no streams here`, several && "a song on more than one client's page counts once"].filter(Boolean).join(" · ")}
      </p>
      <div className="rl-tools">
        <input className="arg-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists or clients" aria-label="Search songs, artists or clients" autoComplete="off" data-rl-search />
        <div className="upd-filters" data-rl-filters>
          {FILTERS.map(([k, label]) => <button key={k} type="button" className={`upd-filter${filter === k ? " on" : ""}`} aria-pressed={filter === k} data-filter={k} onClick={() => setFilter(k)}>{label} ({fmt(counts[k])})</button>)}
        </div>
        <span className="gainer-tabs rl-sort" role="group" aria-label="Sort by" data-rl-sort>
          {[["streams", "Most streams"], ["date", "Newest release"]].map(([k, label]) => <button key={k} type="button" className={by === k ? "active" : ""} aria-pressed={by === k} data-sort={k} onClick={() => setBy(k)}>{label}</button>)}
        </span>
      </div>
      <Waiting loading={loading} failed={failed} retry={retry} />
      {!loading && (shown.length === 0
        ? <p className="hint" data-rl-empty>{rows.length === 0 ? "There are no songs on the roster yet." : q.trim() ? `No song matches “${q.trim()}”.` : filter === "off" ? "No song is marked Not on streaming." : "Every song has what it needs."}</p>
        : <CardTable cols={cols} rows={list} rowKey={(r) => r.key} onRow={(r) => onOpen(r)} className="rl-table" data-rl-table="" />)}
      {!loading && phone && shown.length > list.length && <button type="button" className="btn ghost sm rl-more" data-rl-more onClick={() => setLimit((n) => n + PHONE_ROWS)}>Show {Math.min(PHONE_ROWS, shown.length - list.length)} more ({fmt(shown.length - list.length)} left)</button>}
    </div>
  );
}
