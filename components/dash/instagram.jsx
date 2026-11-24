// (2026-11-16) Site › Instagram: drafts and posts to the company's Instagram in its exact caption format
// (lib/ig-caption.js), from a Spotify link. The server side is pages/api/instagram.js (lib/instagram.js, lib/ig-lookup.js).
// Its code loads only when the tab opens (components/dash/site.jsx).
import { useEffect, useMemo, useState } from "react";
import { Instagram, Upload, Film, Image as ImageIcon, ChevronUp, ChevronLeft, ChevronRight, X, ExternalLink, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { AskCard } from "../portal/ask";
import { captionOf, cleanHandle, validHandle, peopleOf, CREDITS, MAX_COLLABORATORS, MAX_TAGS, MAX_CAPTION } from "../../lib/ig-caption";
import { personKey } from "../../lib/names";

const TYPES = [["single", "Single"], ["album", "Album"], ["video", "Video only"]];
const TYPE_WORD = { single: "single", album: "album", video: "video" };
const FROM_WORD = { roster: "roster", team: "team page", remembered: "last post" };
const MAX_VIDEO = 300 * 1024 * 1024, MAX_SIDE = 1440, MAX_IMAGE = 1.9 * 1024 * 1024;
const aKey = (name) => `a:${personKey(name) || String(name ?? "").trim().toLowerCase()}`;
const pKey = (id) => `p:${id}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

const api = (body) => fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => ({ ...(await r.json().catch(() => ({ error: "The site didn't answer properly. Try again." }))), status: r.status, ok: r.ok }))
  .catch(() => ({ ok: false, status: 0, error: "Couldn't reach the site. Check your connection and try again." }));

// ---- media in the browser: images become a square JPEG (black bars when needed, so Instagram never crops the art) on the
// existing image upload; videos go straight to file storage (@vercel/blob/client, /api/instagram/upload)
async function squareJpeg(file) {
  const src = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error("Couldn't read that image.")); r.readAsDataURL(file); });
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't an image we can use. Use a JPG or PNG.")); i.src = src; });
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (big < 320) throw new Error("That image is too small for Instagram (320 px at least).");
  const side = Math.min(MAX_SIDE, big), scale = side / big;
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = side; canvas.height = side;
  const g = canvas.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, side, side);
  g.drawImage(img, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
  for (const q of [0.92, 0.85, 0.75, 0.65]) {
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= MAX_IMAGE) return blob;
  }
  throw new Error("That image is too big even after shrinking it. Use a smaller one.");
}
async function uploadImage(file) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  const blob = await squareJpeg(file);
  const r = await fetch("/api/upload-image", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Requested-With": "defied-site" }, body: blob }).catch(() => null);
  const j = await r?.json().catch(() => null);
  if (!r?.ok || !j?.url) throw new Error(j?.code === "no-store" ? "File storage isn't set up (BLOB_READ_WRITE_TOKEN), so images can't be uploaded." : j?.error || "Couldn't upload that image. Try again.");
  return j.url;
}
async function uploadVideo(file, onProgress) {
  const { upload } = await import("@vercel/blob/client");
  const mov = file.type === "video/quicktime" || /\.mov$/i.test(file.name);
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "video";
  try {
    const b = await upload(`instagram/${base}.${mov ? "mov" : "mp4"}`, file, {
      access: "public", handleUploadUrl: "/api/instagram/upload", contentType: mov ? "video/quicktime" : "video/mp4",
      multipart: file.size > 20 * 1024 * 1024, headers: { "X-Requested-With": "defied-site" },
      onUploadProgress: (e) => onProgress?.(Math.round(e?.percentage || 0)),
    });
    return b.url;
  } catch (err) {
    throw new Error(/token/i.test(String(err?.message)) ? "Couldn't start the upload (is file storage set up?). Try again." : "The upload didn't finish. Try again.");
  }
}
// how long the video is, and whether it has sound when the browser can tell (Firefox, Safari say so; Chrome only when it
// has decoded some): { local, duration, audio: true | false | null }
function readVideo(file) {
  return new Promise((resolve) => {
    const local = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (o) => { if (!done) { done = true; resolve({ local, duration: null, audio: null, ...o }); } };
    v.preload = "auto"; v.muted = true; v.playsInline = true;
    v.onloadedmetadata = async () => {
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      if (typeof v.mozHasAudio === "boolean") return finish({ duration, audio: v.mozHasAudio });
      if (v.audioTracks && typeof v.audioTracks.length === "number") return finish({ duration, audio: v.audioTracks.length > 0 });
      if ("webkitAudioDecodedByteCount" in v) {
        try { await v.play(); await new Promise((r) => setTimeout(r, 800)); v.pause(); } catch { /* autoplay refused: unknown */ }
        return finish({ duration, audio: v.webkitAudioDecodedByteCount > 0 ? true : null });
      }
      finish({ duration });
    };
    v.onerror = () => finish({});
    setTimeout(() => finish({}), 8000);
    v.src = local;
  });
}

// ---- small parts
function Seg({ value, options, onChange, label }) {
  return (
    <span className="ig-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>)}
    </span>
  );
}
function CreditPick({ value, onChange }) {
  return (
    <div className="ig-credit">
      <Seg value={value} onChange={onChange} label="Credit" options={[["co", CREDITS.co], ["produced", CREDITS.produced]]} />
      <span className="hint">Produced by when only Defied producers (or one person) made it.</span>
    </div>
  );
}
function HandleInput({ value, onChange, name }) {
  const h = cleanHandle(value);
  return (
    <span className={h && !validHandle(h) ? "ig-at bad" : "ig-at"}>
      <span aria-hidden>@</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="handle" aria-label={`${name}'s Instagram handle`} autoComplete="off" spellCheck={false} autoCapitalize="none" />
    </span>
  );
}
function ProducerPick({ roster, value, onChange, label }) {
  const left = roster.filter((c) => !value.includes(c.id));
  const name = (id) => roster.find((c) => c.id === id)?.name || "Someone";
  return (
    <div className="ig-row ig-prods">
      {value.map((id) => <span key={id} className="ig-chip">{name(id)}<button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Take ${name(id)} off`}><X size={12} /></button></span>)}
      <select className="ig-input" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label={label}>
        <option value="">{value.length ? "Add another producer…" : "Add a Defied producer…"}</option>
        {[["Producers", left.filter((c) => c.producer)], ["Other clients", left.filter((c) => !c.producer)]].map(([g, list]) => list.length > 0 && (
          <optgroup key={g} label={g}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.handle ? ` (@${c.handle})` : ""}</option>)}</optgroup>
        ))}
      </select>
    </div>
  );
}
function PersonRow({ p, value, onChange }) {
  return (
    <div className="ig-person" data-ig-person={p.key}>
      <span className="ig-person-name">{p.name}{p.from ? <em className="ig-badge">{FROM_WORD[p.from] || p.from}</em> : <em className="ig-badge new">new</em>}</span>
      <HandleInput value={value} onChange={onChange} name={p.name} />
    </div>
  );
}
function FileButton({ accept, onFile, children, disabled }) {
  return (
    <label className={disabled ? "btn ghost sm ig-file off" : "btn ghost sm ig-file"}>
      {children}
      <input type="file" accept={accept} disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </label>
  );
}

// ---- the connection line: who it's connected as, what's missing, Connect / Disconnect for Founders
const SAID = {
  connected: "Instagram is connected.", cancelled: "Instagram wasn't connected (cancelled).", founders: "Only a Founder can connect Instagram.",
  expired: "That link ran out or was used already. Press Connect Instagram again.",
};
// the "not set up" line names what's missing in Vercel (the server's list), all three until it's known
const setupWords = (missing) => {
  const m = missing?.length ? missing : ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_CONFIG_ID"];
  return `Instagram isn't set up yet: ${m.length > 1 ? `${m.slice(0, -1).join(", ")} and ${m[m.length - 1]} go` : `${m[0]} goes`} in Vercel first.`;
};
function ConnLine({ st, said, reload }) {
  const [asking, setAsking] = useState(false), [err, setErr] = useState(null);
  const last = st.last?.result || said;
  const words = last === "failed" ? `Instagram didn't connect.${st.last?.why ? ` ${st.last.why}` : ""} Try again.` : last === "setup" ? setupWords(st.missing) : SAID[last];
  const connectBtn = st.canConnect && (st.missing?.length
    ? <button type="button" className="btn sm" disabled title="Add the app's keys in Vercel first"><Instagram size={14} /> Connect Instagram</button>
    : <a className="btn sm" href="/api/instagram/connect" data-ig-connect><Instagram size={14} /> {st.connected ? "Reconnect" : "Connect Instagram"}</a>);
  return (
    <div className="ig-conn" data-ig-conn={st.connected ? "on" : "off"}>
      <p className="ig-conn-line">
        <Instagram size={15} />{" "}
        {st.connected ? <span>Connected as <b>@{st.username}</b></span>
          : st.expired ? <span>The Instagram sign-in ran out.{st.canConnect ? "" : " A Founder connects it again."}</span>
          : st.unreadable ? <span>The saved Instagram sign-in can't be read any more.{st.canConnect ? "" : " A Founder connects it again."}</span>
          : <span>Not connected.{st.missing?.length ? ` Missing in Vercel: ${st.missing.join(", ")}.` : st.canConnect ? "" : " A Founder connects it."}</span>}
        {connectBtn && <> {connectBtn}</>}
        {st.connected && st.canConnect && <> <button type="button" className="inline-link" onClick={() => setAsking(true)} data-ig-disconnect>Disconnect</button></>}
      </p>
      {st.connected && st.canPublish === false && <p className="hint ig-warn">Instagram didn't allow posting on this sign-in. Reconnect and allow "content publishing".</p>}
      {!st.postsOn && <p className="hint">Posting is off until <code>INSTAGRAM_POSTS</code> is <code>on</code> in Vercel. You can still draft and preview.</p>}
      {!st.uploads && <p className="hint">Uploads are off until file storage (<code>BLOB_READ_WRITE_TOKEN</code>) is set up: the Spotify cover still works.</p>}
      {words && <p className={last === "connected" ? "hint ok-text" : "hint err-text"} role="status">{words}</p>}
      {err && <p className="hint err-text" role="alert">{err}</p>}
      {asking && (
        <AskCard title="Disconnect Instagram?" goLabel="Disconnect" busyLabel="Disconnecting…" onClose={() => setAsking(false)}
          go={async () => { const r = await api({ action: "disconnect" }); setAsking(false); if (!r.ok) setErr(r.error || "Couldn't disconnect. Try again."); reload(); }}>
          <p>The site forgets its sign-in to @{st.username}. Nothing on Instagram changes; posting stops until a Founder connects it again.</p>
        </AskCard>
      )}
    </div>
  );
}

export function InstagramPanel() {
  const [st, setSt] = useState(null), [stErr, setStErr] = useState(null);
  const load = () => fetch("/api/instagram", { cache: "no-store" })
    .then(async (r) => { const j = await r.json().catch(() => null); if (r.ok && j) { setSt(j); setStErr(null); } else setStErr(j?.error || "Couldn't load Instagram's status. Try again."); })
    .catch(() => setStErr("Couldn't reach the site. Try again."));
  useEffect(() => { load(); }, []);
  // ?instagram=… from the connect / callback (the dashboard may tidy it out of the address; the server keeps the outcome too)
  const [said] = useState(() => { try { return new URLSearchParams(window.location.search).get("instagram"); } catch { return null; } });

  const [type, setType] = useState("single");
  const [link, setLink] = useState(""), [found, setFound] = useState(null), [looking, setLooking] = useState(false), [lookErr, setLookErr] = useState(null);
  const [typed, setTyped] = useState({});      // person key → the handle typed here (else the one the site knows)
  const [prods, setProds] = useState([]);      // Single / Video only: client ids
  const [credit, setCredit] = useState("co");
  const [picks, setPicks] = useState({});      // Album: track n → { prods: [ids], credit } (a ticked track)
  const [cover, setCover] = useState(null);    // an uploaded cover in place of Spotify's: { url }
  const [slide2, setSlide2] = useState(null);  // { kind: "video" | "image", url, local?, name, duration?, audio? }
  const [video, setVideo] = useState(null);    // Video only: { url, local, name, duration, audio }
  const [busy, setBusy] = useState(null), [progress, setProgress] = useState(0), [upErr, setUpErr] = useState(null);
  const [order, setOrder] = useState(null);    // person keys in the order chosen here (null: artists, then producers)
  const [collab, setCollab] = useState(null);  // person keys picked as collaborators (null: the first 3)
  const [caption, setCaption] = useState(null); // the caption as edited (null: the format)
  const [slide, setSlide] = useState(0);
  const [asking, setAsking] = useState(false), [done, setDone] = useState(null), [pubErr, setPubErr] = useState(null), [working, setWorking] = useState(false);

  const roster = st?.roster || [];
  const byId = useMemo(() => new Map(roster.map((c) => [c.id, c])), [roster]);
  const val = (key, fallback) => (key in typed ? typed[key] : fallback || "");
  const setVal = (key) => (v) => setTyped((t) => ({ ...t, [key]: v }));

  const mains = found?.artists || [];
  const isAlbum = type === "album" && found?.kind === "album";
  const featsOf = (t) => (t.artists || []).filter((a) => !mains.some((m) => (m.spotifyId && m.spotifyId === a.spotifyId) || personKey(m.name) === personKey(a.name)));
  const ticked = isAlbum ? found.tracks.filter((t) => picks[t.n]) : [];
  const artistP = (a) => ({ key: aKey(a.name), name: a.name, from: a.from, handle: cleanHandle(val(aKey(a.name), a.handle)) });
  const prodP = (id) => { const c = byId.get(id); return { key: pKey(id), name: c?.name || "Someone", from: c?.from || "", handle: cleanHandle(val(pKey(id), c?.handle)) }; };
  const draft = found && {
    type: isAlbum ? "album" : type === "album" ? "single" : type, title: found.title,
    artists: mains.map(artistP), producers: prods.map(prodP), credit,
    tracks: ticked.map((t) => ({ n: t.n, title: t.name, features: featsOf(t).map(artistP), producers: (picks[t.n].prods || []).map(prodP), credit: picks[t.n].credit })),
  };
  const format = draft ? captionOf(draft) : "";
  const text = caption ?? format;
  const people = draft ? peopleOf(draft) : [];
  const keys = people.map((p) => p.key);
  const ordered = order ? [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))] : keys;
  const ppl = ordered.map((k) => people.find((p) => p.key === k));
  const collabKeys = (collab ? collab.filter((k) => keys.includes(k)) : ordered).slice(0, MAX_COLLABORATORS);
  const collaborators = ppl.filter((p) => collabKeys.includes(p.key) && p.handle).map((p) => p.handle);
  const tags = type === "video" ? [] : ppl.map((p) => p.handle).filter(Boolean).slice(0, MAX_TAGS);
  const missing = people.filter((p) => !validHandle(p.handle));
  // the people whose handle box shows: the artists (with the ticked tracks' features), then each producer once
  const artistRows = draft ? [...draft.artists, ...draft.tracks.flatMap((t) => t.features)].filter((p, i, a) => a.findIndex((x) => x.key === p.key) === i) : [];
  const prodRows = draft ? [...draft.producers, ...draft.tracks.flatMap((t) => t.producers)].filter((p, i, a) => a.findIndex((x) => x.key === p.key) === i) : [];
  const rowSrc = (p) => (p.key.startsWith("a:") ? mains.concat(found?.tracks?.flatMap((t) => t.artists) || []).find((a) => aKey(a.name) === p.key)?.handle : byId.get(p.key.slice(2))?.handle);

  const coverUrl = cover?.url || found?.cover || "";
  const slides = type === "video" ? (video ? [video] : []) : [coverUrl && { kind: "image", url: coverUrl }, slide2].filter(Boolean);
  const at = Math.min(slide, Math.max(0, slides.length - 1));
  const vid = type === "video" ? video : slide2?.kind === "video" ? slide2 : null;
  const rules = type === "video" ? ["Posts as a Reel that also shows on the feed."]
    : slide2?.kind === "video" ? ["Don't add a song: the video's own audio plays."]
    : ["Add the song in the Instagram app after posting (include the intro with the producer tag)."];
  const warns = [
    vid?.duration != null && (vid.duration < 45 || vid.duration > 60) && `This video is ${Math.round(vid.duration)} s. The playbook says 45–60 s.`,
    vid?.audio === false && "This video seems to have no sound. Check it before posting.",
    type === "video" && people.length > MAX_COLLABORATORS && "A Reel has no photo to tag people on: only the 3 collaborators are credited there (everyone is in the caption).",
    (text.match(/@[A-Za-z0-9._]+/g) || []).length > 20 && "Instagram allows 20 @mentions in a caption at most.",
  ].filter(Boolean);

  const why = !st ? "Loading…"
    : !st.connected ? (st.missing?.length ? `Instagram isn't set up yet (${st.missing.join(", ")} missing in Vercel).` : "Instagram isn't connected yet.")
    : !st.postsOn ? "Posting is off until INSTAGRAM_POSTS is on in Vercel."
    : st.pending ? "A post is still waiting on Instagram: Check again first."
    : !found ? "Look up the song first."
    : type === "album" && found.kind !== "album" ? "An Album post needs the album's Spotify link."
    : busy ? "Wait for the upload to finish."
    : type === "video" && !video?.url ? "Add the video."
    : type !== "video" && !coverUrl ? "Add a cover."
    : missing.length ? `Add the @handle for ${missing.map((p) => p.name).join(", ")}.`
    : !text.trim() ? "The caption is empty."
    : text.length > MAX_CAPTION ? `The caption is over Instagram's ${MAX_CAPTION} characters.`
    : null;

  const look = async () => {
    if (!link.trim()) return;
    setLooking(true); setLookErr(null);
    const r = await api({ action: "lookup", url: link.trim() });
    setLooking(false);
    if (!r.ok) return setLookErr(r.error || "Couldn't look that up.");
    setFound(r); setTyped({}); setCover(null); setCaption(null); setOrder(null); setCollab(null); setDone(null); setPubErr(null); setSlide(0);
    // the song's split, where the site has it: preselected, never required
    const known = (ids) => (ids || []).filter((id) => byId.has(id));
    const credOf = (h) => (h?.credit === "produced" ? "produced" : "co");
    setProds(known(r.hint?.producers)); setCredit(credOf(r.hint));
    setPicks(Object.fromEntries((r.tracks || []).filter((t) => known(t.hint?.producers).length).map((t) => [t.n, { prods: known(t.hint.producers), credit: credOf(t.hint), guessed: true }])));
  };
  const pickImage = async (file, which) => {
    setUpErr(null); setBusy(which); setProgress(0);
    try { const url = await uploadImage(file); if (which === "cover") setCover({ url }); else setSlide2({ kind: "image", url, name: file.name }); }
    catch (err) { setUpErr(err.message); } finally { setBusy(null); }
  };
  const pickVideo = async (file, which) => {
    if (!/^video\/(mp4|quicktime)$/i.test(file.type) && !/\.(mp4|mov)$/i.test(file.name)) return setUpErr("Use an MP4 or MOV video.");
    if (file.size > MAX_VIDEO) return setUpErr("That video is over 300 MB.");
    setUpErr(null); setBusy(which); setProgress(0);
    const meta = await readVideo(file);
    try {
      const url = await uploadVideo(file, setProgress);
      const v = { kind: "video", url, name: file.name, ...meta };
      if (which === "video") { if (video?.local) URL.revokeObjectURL(video.local); setVideo(v); } else { if (slide2?.local) URL.revokeObjectURL(slide2.local); setSlide2(v); }
    } catch (err) { URL.revokeObjectURL(meta.local); setUpErr(err.message); } finally { setBusy(null); }
  };
  const dropSlide2 = () => { if (slide2?.local) URL.revokeObjectURL(slide2.local); setSlide2(null); setSlide(0); };
  const moveUp = (k) => { const list = [...ordered]; const i = list.indexOf(k); if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; setOrder(list); } };
  const toggleCollab = (k) => setCollab(collabKeys.includes(k) ? collabKeys.filter((x) => x !== k) : collabKeys.length < MAX_COLLABORATORS ? [...collabKeys, k] : collabKeys);
  const toggleTrack = (t) => setPicks((p) => { const n = { ...p }; if (n[t.n]) delete n[t.n]; else n[t.n] = { prods: [], credit: "co" }; return n; });
  const setPick = (n, patch) => setPicks((p) => ({ ...p, [n]: { ...p[n], ...patch, guessed: false } }));
  const reset = () => { setLink(""); setFound(null); setTyped({}); setProds([]); setCredit("co"); setPicks({}); setCover(null); dropSlide2(); if (video?.local) URL.revokeObjectURL(video.local); setVideo(null); setOrder(null); setCollab(null); setCaption(null); setDone(null); setPubErr(null); };
  const answer = (r, after) => {
    if (r.ok && r.mediaId) { setDone({ permalink: r.permalink || null, rules: after, warning: r.warning || null }); setPubErr(null); }
    else if (r.status === 202 && r.pending) setPubErr(null);
    else setPubErr(r.error || "Instagram didn't take the post. Try again.");
    load();
  };
  const postIt = async () => {
    const post = {
      type: draft.type === "album" ? "album" : type, title: found.title, caption: text, collaborators, tags,
      people: people.filter((p) => validHandle(p.handle)).map(({ name, handle }) => ({ name, handle })),
      ...(type === "video" ? { video: video.url } : { cover: coverUrl, slide2: slide2 ? { kind: slide2.kind, url: slide2.url } : null }),
    };
    const r = await api({ action: "publish", post });
    setAsking(false);
    answer(r, type !== "video" && slide2?.kind !== "video" ? rules : []);
  };
  const resume = async () => { setWorking(true); answer(await api({ action: "publish", resume: true }), []); setWorking(false); };
  const discard = async () => { setWorking(true); await api({ action: "discard" }); setWorking(false); load(); };

  if (stErr && !st) return <p className="home-muted" role="alert"><AlertTriangle size={15} /> {stErr} <button type="button" className="inline-link" onClick={load}>Try again</button></p>;
  if (!st) return <p className="home-muted" aria-busy="true"><RefreshCw size={15} className="spin" /> Loading…</p>;
  return (
    <div className="ig-wrap" data-ig-panel>
      <ConnLine st={st} said={said} reload={load} />
      {st.pending && (
        <div className="ig-pending" role="status" data-ig-pending>
          <RefreshCw size={14} className={working ? "spin" : ""} /> The {TYPE_WORD[st.pending.type] || ""} post{st.pending.title ? ` “${st.pending.title}”` : ""} is still being readied by Instagram (started {new Date(st.pending.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{st.pending.by ? ` by ${st.pending.by}` : ""}).
          {" "}<button type="button" className="btn sm" onClick={resume} disabled={working}>Check again</button>
          {" "}<button type="button" className="inline-link" onClick={discard} disabled={working}>Discard</button>
        </div>
      )}
      {done ? (
        <div className="ig-done" role="status" data-ig-done>
          <p><Check size={16} /> Posted to Instagram.{" "}
            {done.permalink ? <a className="inline-link" href={done.permalink} target="_blank" rel="noreferrer">Open the post <ExternalLink size={12} /></a> : "Instagram didn't give its link yet; it's on the profile."}</p>
          {done.warning && <p className="hint ig-warn" role="alert" data-ig-warning>{done.warning}</p>}
          {done.rules.length > 0 && <p className="hint">Now: {done.rules[0]}</p>}
          <button type="button" className="btn sm" onClick={reset}>Make another post</button>
        </div>
      ) : (
        <div className="ig-page">
          <div className="ig-form">
            <section className="ig-sec">
              <h3>Post type</h3>
              <Seg value={type} onChange={(t) => { setType(t); setSlide(0); }} label="Post type" options={TYPES} />
              <form className="ig-link" onSubmit={(e) => { e.preventDefault(); look(); }}>
                <input className="ig-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder={type === "album" ? "Spotify album link" : "Spotify song link"} aria-label="Spotify link" inputMode="url" autoComplete="off" />
                <button type="submit" className="btn sm" disabled={looking || !link.trim()}>{looking ? "Looking up…" : "Look up"}</button>
              </form>
              {lookErr && <p className="hint err-text" role="alert">{lookErr}</p>}
              {found && (
                <p className="hint" data-ig-found>
                  {found.kind === "album" ? "Album" : "Song"}: <b>{found.title}</b> · {mains.map((a) => a.name).join(", ")}{found.releaseDate ? ` · ${found.releaseDate}` : ""}
                  {type === "single" && found.kind === "album" && found.tracks.length > 1 && <> · <button type="button" className="inline-link" onClick={() => setType("album")}>This is an album: make it an Album post</button></>}
                  {type === "album" && found.kind === "track" && <span className="ig-warn"> · Paste the album's link for an Album post.</span>}
                </p>
              )}
            </section>

            {isAlbum && (
              <section className="ig-sec" data-ig-tracks>
                <h3>Tracks Defied worked on</h3>
                <p className="hint">Tick each one; each gets its own producers and credit.</p>
                <div className="ig-tracks">
                  {found.tracks.map((t) => {
                    const p = picks[t.n], ft = featsOf(t);
                    return (
                      <div key={t.n} className={p ? "ig-track on" : "ig-track"}>
                        <label className="ig-check"><input type="checkbox" checked={!!p} onChange={() => toggleTrack(t)} /> <span>Track {t.n} · {t.name}{ft.length > 0 && <em> ft {ft.map((a) => a.name).join(", ")}</em>}</span></label>
                        {p && <>
                          <ProducerPick roster={roster} value={p.prods} onChange={(v) => setPick(t.n, { prods: v })} label={`Producers on track ${t.n}`} />
                          <CreditPick value={p.credit} onChange={(v) => setPick(t.n, { credit: v })} />
                          {p.guessed && <span className="hint">From the song's split on the site.</span>}
                        </>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {found && (
              <section className="ig-sec" data-ig-artists>
                <h3>Artists</h3>
                {artistRows.map((p) => <PersonRow key={p.key} p={p} value={val(p.key, rowSrc(p))} onChange={setVal(p.key)} />)}
              </section>
            )}

            {found && (
              <section className="ig-sec" data-ig-producers>
                <h3>Defied producers</h3>
                {!isAlbum && <>
                  <ProducerPick roster={roster} value={prods} onChange={setProds} label="Defied producers" />
                  {prods.length > 0 && <CreditPick value={credit} onChange={setCredit} />}
                  {!prods.length && <p className="hint">None: the caption says “Out now!” (an artist's own release).</p>}
                </>}
                {isAlbum && !prodRows.length && <p className="hint">Pick each ticked track's producers above.</p>}
                {prodRows.map((p) => <PersonRow key={p.key} p={p} value={val(p.key, rowSrc(p))} onChange={setVal(p.key)} />)}
              </section>
            )}

            {found && (
              <section className="ig-sec" data-ig-media>
                <h3>Media</h3>
                {type === "video" ? (
                  <div className="ig-media">
                    <div className="ig-slot">
                      {video ? <video className="ig-thumb" src={video.local || video.url} muted playsInline /> : <div className="ig-thumb">One video, posted as a Reel</div>}
                      <FileButton accept="video/mp4,video/quicktime,.mp4,.mov" onFile={(f) => pickVideo(f, "video")} disabled={!!busy || !st.uploads}><Film size={14} /> {video ? "Replace video" : "Add the video"}</FileButton>
                    </div>
                  </div>
                ) : (
                  <div className="ig-media">
                    <div className="ig-slot">
                      <span className="hint">Slide 1 · cover</span>
                      {coverUrl ? <img className="ig-thumb" src={coverUrl} alt="Cover" /> : <div className="ig-thumb">No cover</div>}
                      <span className="ig-row">
                        <FileButton accept="image/jpeg,image/png,image/webp" onFile={(f) => pickImage(f, "cover")} disabled={!!busy || !st.uploads}><Upload size={14} /> Replace</FileButton>
                        {cover && found.cover && <button type="button" className="inline-link" onClick={() => setCover(null)}>Use Spotify's</button>}
                      </span>
                    </div>
                    <div className="ig-slot">
                      <span className="hint">Slide 2 · optional</span>
                      {slide2 ? (slide2.kind === "video" ? <video className="ig-thumb" src={slide2.local || slide2.url} muted playsInline /> : <img className="ig-thumb" src={slide2.url} alt="Slide 2" />)
                        : <div className="ig-thumb">A video, or an image like the tracklist</div>}
                      <span className="ig-row">
                        {slide2 ? <button type="button" className="btn ghost sm" onClick={dropSlide2}><X size={14} /> Remove</button> : <>
                          <FileButton accept="video/mp4,video/quicktime,.mp4,.mov" onFile={(f) => pickVideo(f, "slide2")} disabled={!!busy || !st.uploads}><Film size={14} /> Video</FileButton>
                          <FileButton accept="image/jpeg,image/png,image/webp" onFile={(f) => pickImage(f, "slide2")} disabled={!!busy || !st.uploads}><ImageIcon size={14} /> Image</FileButton>
                        </>}
                      </span>
                    </div>
                  </div>
                )}
                {busy && <p className="hint" role="status"><RefreshCw size={13} className="spin" /> Uploading{progress ? ` ${progress}%` : "…"}</p>}
                {upErr && <p className="hint err-text" role="alert">{upErr}</p>}
              </section>
            )}

            {found && people.length > 0 && (
              <section className="ig-sec" data-ig-people>
                <h3>Collaborators &amp; tags</h3>
                <p className="hint">Always tag and collaborate with all artists and producers. Instagram allows {MAX_COLLABORATORS} collaborators; {type === "video" ? "a Reel can't carry photo tags." : "everyone is tagged on the cover."}</p>
                <div className="ig-people">
                  {ppl.map((p, i) => {
                    const on = collabKeys.includes(p.key);
                    return (
                      <div key={p.key} className="ig-pp" data-ig-pp={p.key}>
                        <button type="button" className="ig-up" onClick={() => moveUp(p.key)} disabled={i === 0} aria-label={`Move ${p.name} up`}><ChevronUp size={14} /></button>
                        <span className="ig-pp-name">{p.handle ? `@${p.handle}` : p.name} <em className="ig-badge">{p.role}</em></span>
                        <span className="ig-pp-what">{on ? (type === "video" ? "Collaborator" : "Collaborator + tagged") : type === "video" ? "In the caption only" : "Tagged only"}</span>
                        <label className="ig-check"><input type="checkbox" checked={on} disabled={!on && collabKeys.length >= MAX_COLLABORATORS} onChange={() => toggleCollab(p.key)} /> <span>Collaborator</span></label>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <aside className="ig-side" data-ig-side>
            <div className="ig-phone" data-ig-preview>
              <div className="ig-ph-head"><span className="ig-ph-av"><Instagram size={13} /></span><b>{st.username || "defiedmgmt"}</b>{collaborators.length > 0 && <span className="ig-ph-and"> and {collaborators.length === 1 ? `@${collaborators[0]}` : `${collaborators.length} others`}</span>}</div>
              <div className={type === "video" ? "ig-ph-media reel" : "ig-ph-media"}>
                {slides.length ? (slides[at].kind === "video" ? <video key={slides[at].url} src={slides[at].local || slides[at].url} controls muted playsInline /> : <img src={slides[at].url} alt="" />)
                  : <div className="ig-ph-empty">{found ? (type === "video" ? "Add the video" : "Add a cover") : "Paste a Spotify link to start"}</div>}
                {slides.length > 1 && <>
                  <button type="button" className="ig-ph-nav l" onClick={() => setSlide(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous slide"><ChevronLeft size={16} /></button>
                  <button type="button" className="ig-ph-nav r" onClick={() => setSlide(Math.min(slides.length - 1, at + 1))} disabled={at === slides.length - 1} aria-label="Next slide"><ChevronRight size={16} /></button>
                </>}
                {type === "video" && slides.length > 0 && <span className="ig-ph-badge">Reel</span>}
              </div>
              {slides.length > 1 && <div className="ig-ph-dots" aria-hidden>{slides.map((_, i) => <span key={i} className={i === at ? "on" : ""} />)}</div>}
              <div className="ig-ph-cap"><b>{st.username || "defiedmgmt"}</b> {text}</div>
            </div>
            {found && <ul className="ig-rules" data-ig-rules>{rules.map((r) => <li key={r}>{r}</li>)}{warns.map((w) => <li key={w} className="ig-warn">{w}</li>)}</ul>}
            {found && (
              <label className="fld ig-cap-edit">
                <span>Caption{caption !== null && caption !== format ? " (edited: it no longer follows the fields above)" : ""}</span>
                <textarea rows={8} value={text} onChange={(e) => setCaption(e.target.value)} data-ig-caption />
                <span className="hint">{text.length} / {MAX_CAPTION}</span>
              </label>
            )}
            {found && caption !== null && caption !== format && <button type="button" className="btn ghost sm" onClick={() => setCaption(null)} data-ig-reset>Reset to the format</button>}
            <div className="ig-post">
              <button type="button" className="btn" onClick={() => { setPubErr(null); setAsking(true); }} disabled={!!why} data-ig-post><Instagram size={15} /> Post to Instagram</button>
              {why && <p className="hint" data-ig-why>{why}</p>}
              {pubErr && <p className="hint err-text" role="alert">{pubErr}</p>}
            </div>
          </aside>
        </div>
      )}

      {st.posts?.length > 0 && (
        <section className="ig-recent" data-ig-recent>
          <h3>Recent posts</h3>
          <ul>{st.posts.map((p) => <li key={p.mediaId || p.at}><span className="hint">{day(p.at)}{p.by ? ` · ${p.by}` : ""}</span> {p.title || (p.caption || "").split("\n")[0]} {p.permalink && <a className="inline-link" href={p.permalink} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>}</li>)}</ul>
        </section>
      )}

      {asking && draft && (
        <AskCard title="Post to Instagram?" goLabel="Post" busyLabel="Posting…" plain onClose={() => setAsking(false)} go={postIt}>
          <p>This goes on <b>@{st.username}</b> now, for everyone to see.</p>
          {collaborators.length > 0 && <p className="hint">Collaborators (they get an invite): {collaborators.map((h) => `@${h}`).join(" ")}</p>}
          {tags.length > 0 && <p className="hint">Tagged on the cover: {tags.map((h) => `@${h}`).join(" ")}</p>}
          {vid && <p className="hint">Instagram takes a little while with a video; this waits up to a minute.</p>}
        </AskCard>
      )}
    </div>
  );
}
