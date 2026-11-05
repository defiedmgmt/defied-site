import { useState } from "react";
import dynamic from "next/dynamic";
import { saveRow } from "../app/saves";
import { ClientsAdmin, Editor, SubsAdmin, TeamAdmin, UsersAdmin } from "./admin";
import { SpotifyFill } from "./clients";
import { SectionWait } from "./sections";
import { Field, PhotoUpload, revealChip, uid } from "./ui";
// Site › Sync lives with Home (home.jsx): its code comes when Sync opens, so Site alone doesn't load Home's (list B #11)
const SyncView = dynamic(() => import("./home").then((m) => m.SyncView), { ssr: false, loading: SectionWait });

// Site: the public website's content, the logins, the contact form's messages, and the Sync view
const SITE_SECS = [["website", "Website"], ["users", "Users"], ["messages", "Messages"], ["sync", "Sync"]];
export function SiteAdmin({ ctx, sub, onSub, chip }) {
  const { db, commit, songInfo } = ctx;
  // Users is user management; the rest is Site's. Sync reads every artist at once.
  const secs = SITE_SECS.filter(([id]) => (id === "users" ? ctx.can("users") : ctx.can("site") && !(id === "sync" && db.access?.ownOnly)));
  const want = ["users", "messages", "sync"].includes(sub) ? sub : "website";
  const sec = secs.some(([id]) => id === want) ? want : secs[0]?.[0];
  return (
    <div className="site-page">
      <div className="admin-head"><h2>Site</h2>{chip}</div>
      <div className="subnav" role="tablist" aria-label="Site">
        {secs.map(([id, label]) => <button key={id} role="tab" aria-selected={sec === id} data-site-tab={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { onSub(id === "website" ? null : id); revealChip(e.currentTarget); }}>{label}</button>)}
      </div>
      {sec === "website" && <WebsiteAdmin db={db} commit={commit} sub={sub} onSub={onSub} songInfo={songInfo} embedded />}
      {sec === "users" && <UsersAdmin db={db} commit={commit} reloadDb={ctx.reloadDb} />}
      {sec === "messages" && <SubsAdmin db={db} commit={commit} />}
      {sec === "sync" && <SyncView ctx={ctx} />}
    </div>
  );
}

/* staff: website content (about, roster, staff, notable) -------------- */
const WEBSITE_SECS = [["roster", "Roster"], ["notable", "Notable releases"], ["staff", "Team"], ["about", "About page"]];
const WEB_SEC_KEY = "dm-web-sec";
// embedded: inside Site, which has the page's title
function WebsiteAdmin({ db, commit, sub, onSub, songInfo = null, embedded = false }) {
  const secs = WEBSITE_SECS;
  // a Dashboard task's sub wins, then the last tab used in this browser tab, then Roster (the weekly work)
  const openId = sub?.startsWith("roster:") ? sub.slice(7) : null; // To do's "Set X's sheet tab"
  const [sec, setSecOnly] = useState(() => {
    if (openId) return "roster";
    if (secs.some(([id]) => id === sub)) return sub;
    try { const v = sessionStorage.getItem(WEB_SEC_KEY); if (secs.some(([id]) => id === v)) return v; } catch { /* storage blocked */ }
    return "roster";
  });
  const setSec = (id) => { setSecOnly(id); onSub?.(id); try { sessionStorage.setItem(WEB_SEC_KEY, id); } catch { /* storage blocked */ } };
  return (
    <div className="website-main">
      {!embedded && <div className="admin-head website-head"><h2>Website</h2></div>}
      <div className="subnav">
        {secs.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "about" && <AboutEditor db={db} commit={commit} />}
      {sec === "roster" && <ClientsAdmin db={db} commit={commit} openId={openId} songInfo={songInfo} />}
      {sec === "staff" && <TeamAdmin db={db} commit={commit} />}
      {sec === "notable" && <NotableAdmin db={db} commit={commit} />}
    </div>
  );
}

function AboutEditor({ db, commit }) {
  const [text, setText] = useState(db.site?.about || "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const ok = await commit({ ...db, site: { ...db.site, about: text } }).finally(() => setSaving(false));
    if (!ok) return; // the banner says why; the text stays in the box
    setSaved(true); setTimeout(() => setSaved(false), 1600);
  };
  return (
    <div>
      <div className="admin-head"><h2>About page</h2><button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</button></div>
      <p className="muted mb">This text shows on the public About page. Leave a blank line between paragraphs.</p>
      <textarea className="about-editor" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

function NotableAdmin({ db, commit }) {
  const list = db.notableReleases || [];
  const save = async (o) => {
    const notableReleases = o.id ? list.map((r) => r.id === o.id ? o : r) : [...list, { ...o, id: uid() }];
    return saveRow(commit, { ...db, notableReleases }, "notableReleases", o.id, "notable release");
  };
  const del = async (id) => commit({ ...db, notableReleases: list.filter((r) => r.id !== id) });
  const cols = [
    { key: "cover", label: "", w: "44px", render: (r) => r.cover ? <img className="rel-thumb" src={r.cover} alt="" loading="lazy" decoding="async" /> : <span className="rel-thumb rel-thumb-empty" /> },
    { key: "song", label: "Song", w: "1.2fr" },
    { key: "artist", label: "Artist", w: "0.9fr" },
    { key: "client", label: "Client", w: "0.9fr" },
  ];
  return (
    <div>
      <p className="muted mb">The songs on the About page. Paste a Spotify link to fill in the details.</p>
      <Editor title="Notable releases" items={list} columns={cols} maxItems={10}
        blank={{ song: "", artist: "", client: "", releaseDate: "", link: "", cover: "" }}
        onSave={save} onDelete={del}
        extra={(e, set) => (
          <>
            <SpotifyFill e={e} set={set} />
            <PhotoUpload label="Cover art" value={e.cover} onChange={(v) => set({ ...e, cover: v })} />
            <Field label="Song" value={e.song} onChange={(ev) => set({ ...e, song: ev.target.value })} />
            <Field label="Artist" value={e.artist} onChange={(ev) => set({ ...e, artist: ev.target.value })} />
            <Field label="Client" value={e.client} onChange={(ev) => set({ ...e, client: ev.target.value })} />
            <Field label="Release date" type="date" value={e.releaseDate} onChange={(ev) => set({ ...e, releaseDate: ev.target.value })} />
            <Field label="Streaming link (opens on click)" value={e.link} onChange={(ev) => set({ ...e, link: ev.target.value })} />
          </>
        )}
      />
    </div>
  );
}
