import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Pencil, Check, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { filledSplits } from "../../lib/splits";
import LinkBox from "../LinkBox";
import { SECTIONS, ROLES, accessFor, cleanAccess, sameManager } from "../../lib/roles";
import { changedFields, saveRow } from "../app/saves";
import { canUse } from "./StaffDashboard";
import { findTabClient, noTabNames, shortDay } from "./helpers";
import { Area, Avatar, EmailButton, Field, PhotoUpload, SplitsEditor, splitTotal, uid, useEscape } from "./ui";
import { AskCard } from "../portal/ClientPortal";
import { ownSplit, sameName } from "../site/data";

/* generic editable list ------------------------------------------------ */
export function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete, openId = null, noAdd = false }) {
  const [editing, setEditing] = useState(null); // object or null
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [delAsk, setDelAsk] = useState(null); // the row its Delete asks about
  const [listErr, setListErr] = useState(null); // a Delete that was refused ("There has to be at least one staff account.")
  const from = useRef(null); // the row as it was when the form opened
  useEscape(() => setEditing(null), !!editing && !saving); // as Cancel: a save in flight finishes into its own form
  useEffect(() => {
    if (!editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [editing]);
  const start = (obj) => { from.current = obj; setFormErr(null); setEditing(obj ? { ...obj } : { id: null, ...blank }); };
  // a link to one row (To do's "Set X's sheet tab") opens its form
  useEffect(() => { const it = openId && items.find((x) => x.id === openId); if (it) start(it); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // only what was changed in the form goes onto the row as it is now, so a change that landed while
  // it was open (another tab's save, the Clients-tab sync) isn't put back. A failed save stays open:
  // onSave gives false (the banner says why) or a message for the form.
  const save = async () => {
    const cur = editing.id && items.find((it) => it.id === editing.id);
    setSaving(true); setFormErr(null);
    try {
      const ok = await onSave(cur && from.current ? { ...cur, ...changedFields(from.current, editing) } : editing);
      if (typeof ok === "string") setFormErr(ok);
      else if (ok !== false) setEditing(null);
    } finally { setSaving(false); }
  };
  const remove = (it) => { setListErr(null); setDelAsk(it); };
  // confirmDelete(row) can give its own {title, body, typeName, goLabel}
  const ask = delAsk && { title: `Delete "${delAsk.name || delAsk.song || delAsk.email || "this entry"}"?`, body: "This can't be undone.", goLabel: "Delete", ...(confirmDelete ? confirmDelete(delAsk) : {}) };
  const gridCols = { "--cols": columns.map((c) => c.w || "1fr").join(" ") + (onReorder ? " 128px" : " 72px") };
  const atMax = !!maxItems && items.length >= maxItems;
  // reorder rows carry 4 action buttons (up/down/edit/delete) instead of 2,
  // so they need their own, wider mobile column — see .admin-row-reorder.
  const rowCls = "admin-row" + (onReorder ? " admin-row-reorder" : "");
  return (
    <div>
      <div className="admin-head">
        <h2>{title}{maxItems ? ` — ${items.length}/${maxItems}` : ""}</h2>
        {!noAdd && <button className="btn sm" onClick={() => start(null)} disabled={atMax} title={atMax ? `Remove one to add another (max ${maxItems})` : undefined}><Plus size={15} /> Add</button>}
      </div>
      {listErr && <p className="hint err-text mb" role="alert">{listErr}</p>}
      {ask && (
        <AskCard title={ask.title} goLabel={ask.goLabel} busyLabel="Deleting…" typeName={ask.typeName} onClose={() => setDelAsk(null)}
          go={async () => { const r = await onDelete(delAsk.id); setDelAsk(null); setListErr(typeof r === "string" ? r : null); }}>
          <p>{ask.body}</p>
        </AskCard>
      )}
      <div className="admin-table">
        <div className={`${rowCls} admin-hd`} style={gridCols}>
          {columns.map((c) => <span key={c.key}>{c.label}</span>)}
          <span className="admin-act">Actions</span>
        </div>
        {items.length === 0 && <div className="admin-empty">Nothing here yet. Click “Add”.</div>}
        {items.map((it, i) => (
          <div className={rowCls} key={it.id} style={gridCols}>
            {columns.map((c) => <span key={c.key} className="cell">{c.render ? c.render(it) : (it[c.key] || "—")}</span>)}
            <span className="admin-act">
              {onReorder && (
                <>
                  <button onClick={() => onReorder(it.id, -1)} disabled={i === 0} title="Move up"><ChevronUp size={14} /></button>
                  <button onClick={() => onReorder(it.id, 1)} disabled={i === items.length - 1} title="Move down"><ChevronDown size={14} /></button>
                </>
              )}
              <button onClick={() => start(it)} aria-label={`Edit ${it.name || it.song || it.email || "entry"}`}><Pencil size={14} /></button>
              {onDelete && <button onClick={() => remove(it)} aria-label={`Delete ${it.name || it.song || it.email || "entry"}`}><Trash2 size={14} /></button>}
            </span>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head">
              <h3>{editing.id ? "Edit" : "New"} {title.replace(/s$/, "")}</h3>
              <button onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="modal-body">{extra(editing, setEditing)}</div>
            {formErr && <p className="hint err-text modal-save-warn" role="alert">{formErr}</p>}
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared by ClientsAdmin (Website -> Roster) and CatalogAdmin (Clients tab) —
// deleting a client removes them and every one of their songs locally, then
// clears each song's row off the pub sheet (only this client's own row —
// never a co-writer's) and finally releases the client's own tab back into
// the generic WRITER pool. Returns a warning string on partial failure, or
// null if everything cleared cleanly.
// the client header's More ▾: Delete client lives here, away from the chips you click all day
export function ClientMore({ onDelete }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="client-more" ref={box}>
      <button className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>More <ChevronDown size={14} /></button>
      {open && (
        <div className="client-more-menu" role="menu">
          <button role="menuitem" data-del-client onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} /> Delete client</button>
        </div>
      )}
    </div>
  );
}
// Delete client: what goes with them, and their name typed to confirm (both Publishing and Website › Roster)
export function clientDeleteAsk(db, c) {
  const n = db.placements.filter((p) => p.clientId === c.id).length;
  const hasLogin = db.users.some((u) => u.clientId === c.id);
  const tab = c.sheetTabName?.trim() || c.name;
  return {
    title: `Delete ${c.name}?`, goLabel: "Delete client", typeName: c.name,
    body: `${n ? `Deletes ${c.name}'s ${n} song${n === 1 ? "" : "s"} and clears their rows on the ${tab} tab.` : `${c.name} has no songs.`}${c.onRoster ? " Takes them off the public roster." : ""}${hasLogin ? " Removes their login." : ""} This can't be undone. Type ${c.name} to confirm.`,
  };
}
export async function deleteClientCascade(db, commit, id) {
  const client = db.clients.find((c) => c.id === id);
  const clientPlacements = db.placements.filter((p) => p.clientId === id);
  // a login account left pointing at a deleted client is a real login that
  // just 404s on their own data forever instead of being cleaned up — same
  // class of gap as data the UI hides but the API still allows; remove it
  // here instead of leaving stale valid credentials with nothing behind them.
  const saved = await commit({
    ...db,
    clients: db.clients.filter((c) => c.id !== id),
    placements: db.placements.filter((p) => p.clientId !== id),
    users: db.users.filter((u) => u.clientId !== id),
  }, db);
  // still on the site: their sheet rows and tab must stay too (the banner says why it failed)
  if (!saved) return null;

  const results = await Promise.allSettled(
    clientPlacements
      .filter((p) => ownSplit(p, client))
      .map(async (p) => {
        const splits = [{ name: client?.sheetTabName || client?.name }];
        const res = await fetch("/api/sheets-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
          body: JSON.stringify({ placementId: p.id, splits }),
        });
        if (!res.ok) throw new Error(p.song);
      })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) {
    return `Deleted locally, but ${failed} of ${clientPlacements.length} song row${clientPlacements.length === 1 ? "" : "s"} couldn't be cleared from the pub sheet. Check it manually if needed.`;
  }

  try {
    const tabName = client?.sheetTabName || client?.name;
    if (tabName) {
      const res = await fetch("/api/sheets-release-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ tabName }),
      });
      if (!res.ok) throw new Error();
    }
  } catch {
    return `Deleted and cleared their songs, but couldn't reset their tab on the pub sheet. It'll just sit empty under their old name — harmless, but you can rename it back to a WRITER slot by hand if you'd like.`;
  }
  return null;
}

// another client already going by `value` as their name or sheet tab: the two would share one tab on
// the pub sheet (or one would never find theirs). By personKey, so Stackie is Stack!e's but Stacke is free
export const NAME_TAKEN = "Another client already uses that name or sheet tab.";
export const nameTaken = (clients, id, value) => !!String(value || "").trim()
  && clients.some((o) => o.id !== id && [o.name, o.sheetTabName].some((s) => String(s || "").trim() && sameName(s, value)));

export function ClientsAdmin({ db, commit, openId = null, songInfo = null }) {
  // the clients the "numbers can't sync" To do names: each row says so, and its form says why
  const noTab = noTabNames(db, songInfo).map((n) => findTabClient(db, n)).filter(Boolean);
  const noTabIds = new Set(noTab.map((c) => c.id));
  const cols = [
    { key: "name", label: "Name", render: (c) => <span className="cell-name"><Avatar src={c.photo} name={c.name} size={30} />{c.name}{noTabIds.has(c.id) && <span className="tab-missing" data-tab-missing title="The pub sheet has no tab by this name">No sheet tab</span>}</span> },
    // Credit (the edit form's "Credit / descriptor") only gets a column once a client has one (list A 7: all blank)
    { key: "role", label: "Role" }, ...(db.clients.some((c) => (c.credit || "").trim()) ? [{ key: "credit", label: "Credit" }] : []),
    { key: "onRoster", label: "Public", render: (c) => c.onRoster !== false ? <span className="badge-yes"><Check size={12} /> Live</span> : <span className="badge-no">Hidden</span> },
  ];
  const [deleteWarn, setDeleteWarn] = useState(null);
  // only a name/tab being changed is checked, so an older pair that already clashes still saves other edits
  const taken = (e, key) => (e[key] || "") !== (db.clients.find((c) => c.id === e.id)?.[key] || "") && nameTaken(db.clients, e.id, e[key]);
  const save = async (o) => {
    if (taken(o, "name") || taken(o, "sheetTabName")) return false; // the form stays open, saying why
    const clients = o.id ? db.clients.map((c) => c.id === o.id ? o : c) : [...db.clients, { ...o, id: uid() }];
    return saveRow(commit, { ...db, clients }, "clients", o.id, "client");
  };
  const del = async (id) => {
    setDeleteWarn(null);
    const warn = await deleteClientCascade(db, commit, id);
    if (warn) setDeleteWarn(warn);
  };
  const reorder = async (id, dir) => {
    const i = db.clients.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= db.clients.length) return;
    const clients = [...db.clients];
    [clients[i], clients[j]] = [clients[j], clients[i]];
    await commit({ ...db, clients });
  };
  return (
    <div>
    <p className="muted mb">Order here is the order they appear on the public Roster page — use the arrows to move someone up or down.</p>
    {deleteWarn && <p className="hint err-text mb">{deleteWarn}</p>}
    {noTab.length > 1 && <p className="hint warn-text mb" data-tab-missing-note><AlertTriangle size={14} /> {noTab.length} clients have no tab on the pub sheet, so their numbers can't sync. Open each one marked "No sheet tab" and type its tab name.</p>}
    <Editor title="Clients" items={db.clients} columns={cols}
      blank={{ name: "", role: "Producer", credit: "", bio: "", photo: "", spotify: "", apple: "", instagram: "", tiktok: "", youtube: "", soundcloud: "", sheetTabName: "", onRoster: false }}
      onSave={save} onDelete={canUse(db, "publishing") && !db.access?.ownOnly ? del : undefined} onReorder={db.access?.ownOnly ? undefined : reorder} noAdd={!!db.access?.ownOnly} openId={openId}
      confirmDelete={(c) => clientDeleteAsk(db, c)}
      extra={(e, set) => (
        <>
          <label className="check-row">
            <input type="checkbox" checked={e.onRoster !== false} onChange={(ev) => set({ ...e, onRoster: ev.target.checked })} />
            <span>Show on the public roster page.</span>
          </label>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          {taken(e, "name") && <p className="hint err-text">{NAME_TAKEN}</p>}
          <label className="fld"><span>Role</span>
            <select value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })}>
              <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
            </select>
          </label>
          <Field label="Credit / descriptor" value={e.credit} onChange={(ev) => set({ ...e, credit: ev.target.value })} />
          <PhotoUpload label="Photo" value={e.photo} onChange={(v) => set({ ...e, photo: v })} />
          <Area label="Bio" value={e.bio} onChange={(ev) => set({ ...e, bio: ev.target.value })} />
          <Field label="Spotify URL" value={e.spotify} onChange={(ev) => set({ ...e, spotify: ev.target.value })} />
          <Field label="Apple Music URL" value={e.apple} onChange={(ev) => set({ ...e, apple: ev.target.value })} />
          <Field label="YouTube URL" value={e.youtube} onChange={(ev) => set({ ...e, youtube: ev.target.value })} />
          <Field label="Instagram handle" value={e.instagram} onChange={(ev) => set({ ...e, instagram: ev.target.value })} />
          <Field label="TikTok handle" value={e.tiktok} onChange={(ev) => set({ ...e, tiktok: ev.target.value })} />
          <Field label="SoundCloud URL" value={e.soundcloud} onChange={(ev) => set({ ...e, soundcloud: ev.target.value })} />
          {/* opened from To do's "Set X's sheet tab": this field has the focus and says what's wrong */}
          <Field label="Sheet tab name" value={e.sheetTabName} onChange={(ev) => set({ ...e, sheetTabName: ev.target.value })} autoFocus={!!openId && e.id === openId} data-sheet-tab=""
            hint={`${(openId && e.id === openId) || noTabIds.has(e.id) ? `The pub sheet has no tab called ${db.clients.find((c) => c.id === e.id)?.sheetTabName?.trim() || db.clients.find((c) => c.id === e.id)?.name}. ` : ""}Only needed if their tab on the pub sheet goes by a different name. Case, accents, punctuation and a “!” used as an i don't count — Stack!e already finds a tab named Stackie.`} />
          {taken(e, "sheetTabName") && <p className="hint err-text">{NAME_TAKEN}</p>}
        </>
      )}
    />
    </div>
  );
}

function PlacementsAdmin({ db, commit }) {
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || "—";
  const cols = [
    { key: "cover", label: "", w: "44px", render: (p) => p.cover ? <img className="rel-thumb" src={p.cover} alt="" loading="lazy" decoding="async" /> : <span className="rel-thumb rel-thumb-empty" /> },
    { key: "song", label: "Song", w: "1.3fr" },
    { key: "clientId", label: "Client", w: "1fr", render: (p) => clientName(p.clientId) },
    { key: "splits", label: "Splits", w: "0.8fr", render: (p) => `${(p.splits || []).length} · ${splitTotal(p.splits)}%` },
    { key: "notable", label: "Featured", w: "0.8fr", render: (p) => p.notable ? <span className="badge-yes"><Check size={12} /> Notable</span> : <span className="badge-no">—</span> },
  ];
  const save = async (o0) => {
    const o = { ...o0, splits: filledSplits(o0.splits) }; // what the splits editor shows: the even default filled in
    const placements = o.id ? db.placements.map((p) => p.id === o.id ? o : p) : [...db.placements, { ...o, id: uid() }];
    return commit({ ...db, placements });
  };
  const del = async (id) => commit({ ...db, placements: db.placements.filter((p) => p.id !== id) });
  return (
    <Editor title="Songs" items={db.placements} columns={cols}
      blank={{ clientId: db.clients[0]?.id || "", song: "", artist: "", releaseDate: "", link: "", cover: "", notable: false, splits: [] }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <label className="fld"><span>Client (Defied roster member)</span>
            <select value={e.clientId} onChange={(ev) => set({ ...e, clientId: ev.target.value })}>
              {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <SpotifyFill e={e} set={set} />
          <PhotoUpload label="Cover art" value={e.cover} onChange={(v) => set({ ...e, cover: v })} />
          <Field label="Song" value={e.song} onChange={(ev) => set({ ...e, song: ev.target.value })} />
          <Field label="Artist (performer)" value={e.artist} onChange={(ev) => set({ ...e, artist: ev.target.value })} />
          <Field label="Release date" type="date" value={e.releaseDate} onChange={(ev) => set({ ...e, releaseDate: ev.target.value })} />
          <Field label="Streaming link (opens on click)" value={e.link} onChange={(ev) => set({ ...e, link: ev.target.value })} />
          <SplitsEditor splits={e.splits} onChange={(v) => set({ ...e, splits: v })} />
          <label className="check-row">
            <input type="checkbox" checked={!!e.notable} onChange={(ev) => set({ ...e, notable: ev.target.checked })} />
            <span>Feature as a Notable Release — shows on the artist's profile. Split data stays private.</span>
          </label>
        </>
      )}
    />
  );
}

// The song forms' "paste a link" box (list B #7: components/LinkBox.jsx, POST /api/resolve-link): a
// Spotify song link fills in the title, artist, cover and release date, and says when the song is
// already on someone's page (co-writers share songs, so it can still be filled in)
export function SpotifyFill({ e, set }) {
  const [done, setDone] = useState(false);
  const fill = (r) => {
    const c = r.card || {};
    // onto the form as it is now, so anything typed during the lookup stays
    set((cur) => ({
      ...cur,
      song: c.name || cur.song,
      artist: c.artist || cur.artist,
      releaseDate: cur.releaseDate || c.releaseDate || "",
      cover: c.image || cur.cover,
      link: r.link?.url || cur.link,
    }));
    setDone(true);
  };
  return (
    <div className="sp-fill" data-sp-fill>
      <span className="fld-label">Paste the song's Spotify link to fill this in</span>
      <LinkBox context="roster" kinds={["song"]} addLabel="Fill in" allowDuplicate onAdd={fill} />
      {done && <span className="sp-note ok"><Check size={12} /> Filled in. Review the fields below.</span>}
    </div>
  );
}

export function TeamAdmin({ db, commit }) {
  const cols = [
    { key: "name", label: "Name", render: (s) => <span className="cell-name"><Avatar src={s.photo} name={s.name} size={30} />{s.name}</span> },
    { key: "role", label: "Role" }, { key: "email", label: "Email" },
  ];
  const save = async (o) => {
    const staff = o.id ? db.staff.map((s) => s.id === o.id ? o : s) : [...db.staff, { ...o, id: uid() }];
    return saveRow(commit, { ...db, staff }, "staff", o.id, "team member");
  };
  const del = async (id) => commit({ ...db, staff: db.staff.filter((s) => s.id !== id) });
  return (
    <Editor title="Team" items={db.staff} columns={cols}
      blank={{ name: "", role: "", email: "", instagram: "", bio: "", photo: "" }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field label="Role" value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })} />
          <Field label="Email" value={e.email} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field label="Instagram handle" value={e.instagram} onChange={(ev) => set({ ...e, instagram: ev.target.value })} />
          <PhotoUpload label="Photo" value={e.photo} onChange={(v) => set({ ...e, photo: v })} />
          <Area label="Bio" value={e.bio} onChange={(ev) => set({ ...e, bio: ev.target.value })} />
        </>
      )}
    />
  );
}

// Site › Users: the logins. A Founder also sets each staff login's role (lib/roles.js: Founder,
// Co-manager, Intern) and can turn any section on or off for that person on top of the role. The
// server checks all of it on every request; this only shows it.
const ROLE_PICK = [["founder", "Founder"], ["comanager", "Co-manager"], ["intern", "Intern"], ["client", "Client"]];
const SECTION_OF = Object.fromEntries(SECTIONS);
function useManagers(reloadDb) {
  const [st, setSt] = useState({ at: undefined, busy: false, err: null });
  const update = async () => {
    setSt((x) => ({ ...x, busy: true, err: null }));
    const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "managers" }) }).catch(() => null);
    const d = r && (await r.json().catch(() => null));
    if (r?.ok) { await reloadDb?.(); setSt({ at: d.at, busy: false, err: null }); } else setSt((x) => ({ ...x, busy: false, err: d?.error || "Couldn't read the accounting sheet just now." }));
  };
  useEffect(() => {
    let alive = true;
    fetch("/api/access", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive || !d) return;
      setSt((x) => ({ ...x, at: d.managersAt }));
      if (!d.managersAt) update(); // never read yet: read it once now
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, update };
}
export function UsersAdmin({ db, commit, reloadDb }) {
  const founder = db.access?.role === "founder";
  const anyFounder = db.users.some((u) => u.role === "staff" && u.staffRole === "founder");
  const pickOf = (u) => (u.role === "client" ? "client" : ROLES[u.staffRole] ? u.staffRole : anyFounder ? "comanager" : "founder");
  const accessOf = (u) => accessFor({ staffRole: pickOf(u), access: u.access, name: u.name }, { anyFounder: true });
  const artistsOf = (name) => db.clients.filter((c) => sameManager(c.manager, name));
  const managers = useManagers(reloadDb);
  const who = (u) => {
    if (u.role === "client") return `Client · ${db.clients.find((c) => c.id === u.clientId)?.name || "no client linked"}`;
    const a = accessOf(u);
    return `${ROLES[a.role].label}${a.ownOnly ? ` · own artists (${artistsOf(u.name).length})` : ""}`;
  };
  const cols = [
    { key: "email", label: "Email", render: (u) => <span className="cell-name">{u.email}{u.name ? <span className="muted"> · {u.name}</span> : null}</span> },
    { key: "role", label: "Access", render: (u) => <span data-user-access={u.id}>{who(u)}</span> },
  ];
  const save = async (o) => {
    // the server skips a new login with no password, which would leave it on screen but never saved
    if (!o.id && !(o.password || "").trim()) return "Enter a password to create this account.";
    const users = o.id ? db.users.map((u) => u.id === o.id ? o : u) : [...db.users, { ...o, id: uid() }];
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    return saveRow(commit, { ...db, users }, "users", o.id, "user");
  };
  const del = async (id) => {
    const users = db.users.filter((u) => u.id !== id);
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    await commit({ ...db, users });
  };
  const setPick = (e, set, v) => set({ ...e, role: v === "client" ? "client" : "staff", staffRole: v === "client" ? null : v,
    access: v === "comanager" && e.access?.ownOnly ? { ownOnly: true } : {} });
  const setSection = (e, set, k, on) => set({ ...e, access: cleanAccess(pickOf(e), { ...e.access, sections: { ...(e.access?.sections || {}), [k]: on } }) });
  return (
    <>
    <Editor title="Users" items={db.users} columns={cols}
      blank={{ email: "", password: "", role: "staff", staffRole: "comanager", access: {}, name: "", clientId: null }}
      onSave={save} onDelete={del}
      extra={(e, set) => {
        const pick = pickOf(e), a = e.role === "staff" ? accessOf(e) : null, mine = a?.ownOnly ? artistsOf(e.name) : [];
        return (
        <>
          <Field label="Email" value={e.email} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field label="Name" value={e.name || ""} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field
            label="Password" value={e.password} onChange={(ev) => set({ ...e, password: ev.target.value })}
            hint={e.id ? "Leave blank to keep their current password. At least 8 characters if you're setting a new one." : "At least 8 characters — required to create the account."}
          />
          <label className="fld"><span>Role</span>
            <select value={pick} data-role-pick onChange={(ev) => setPick(e, set, ev.target.value)} disabled={!founder && e.role === "staff"}>
              {ROLE_PICK.filter(([k]) => founder || k === "client" || k === pick).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          {e.role === "client" && (
            <label className="fld"><span>Link to roster client</span>
              <select value={e.clientId || ""} onChange={(ev) => set({ ...e, clientId: ev.target.value || null })}>
                <option value="">— none —</option>
                {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {e.role === "staff" && founder && pick === "comanager" && (
            <label className="check-row" data-own-only>
              <input type="checkbox" checked={!!e.access?.ownOnly} onChange={(ev) => set({ ...e, access: cleanAccess("comanager", { ...e.access, ownOnly: ev.target.checked }) })} />
              <span>Only their own artists: the ones with this name as Assigned Manager on the accounting sheet's INFO tab.</span>
            </label>
          )}
          {a?.ownOnly && (
            <p className="hint" data-own-artists>{!(e.name || "").trim() ? "Type their name above, as INFO spells it." : mine.length ? `Their artists: ${mine.map((c) => c.name).join(", ")}.` : `No artist has "${e.name.trim()}" as Assigned Manager yet.`}
              {" "}<button type="button" className="inline-link" onClick={managers.update} disabled={managers.busy}>{managers.busy ? "Reading the sheet…" : "Update from the sheet"}</button>
              {managers.err && <span className="err-text"> {managers.err}</span>}</p>
          )}
          {e.role === "staff" && founder && (
            <fieldset className="fld sec-picks" data-sections>
              <legend>What they can open</legend>
              {SECTIONS.map(([k]) => {
                const locked = k === "users" && pick === "founder";
                return (
                  <label key={k} className={`sec-pick${locked ? " locked" : ""}`} data-section={k}>
                    <input type="checkbox" checked={a.sections.includes(k)} disabled={locked} onChange={(ev) => setSection(e, set, k, ev.target.checked)} />
                    <span>{SECTION_OF[k]}</span>
                  </label>
                );
              })}
              <p className="hint">{ROLES[pick].label} starts with {pick === "founder" ? "everything" : pick === "comanager" ? "everything but Money and Users" : "Site only"}. Tick or untick to change it for this person.</p>
            </fieldset>
          )}
          <p className="hint">Clients only see their own placements and splits. They can never edit the website.</p>
        </>
        );
      }}
    />
    {founder && <p className="hint users-managers" data-managers-at>Each artist's manager comes from the accounting sheet's INFO tab{managers.at ? `, read ${shortDay(managers.at)}` : ""}. <button type="button" className="inline-link" onClick={managers.update} disabled={managers.busy}>{managers.busy ? "Reading the sheet…" : "Update from the sheet"}</button>{managers.err && <span className="err-text"> {managers.err}</span>}</p>}
    </>
  );
}

export function SubsAdmin({ db, commit }) {
  const unreadCount = db.submissions.filter((s) => !s.read).length;
  const toggleRead = (id) => {
    commit({ ...db, submissions: db.submissions.map((s) => (s.id === id ? { ...s, read: !s.read } : s)) });
  };
  return (
    <div>
      <div className="admin-head">
        <h2>Messages{unreadCount > 0 && <span className="nav-badge msg-count-badge">{unreadCount}</span>}</h2>
      </div>
      {db.submissions.length === 0 ? <div className="admin-empty">No messages yet.</div> : (
        <div className="subs">
          {db.submissions.map((s) => (
            <div key={s.id} className={s.read ? "sub-card" : "sub-card unread"}>
              <div className="sub-top">
                <div className="sub-top-info">
                  {!s.read && <span className="sub-dot" title="Unread" />}
                  <strong>{s.name}</strong>
                  <span className="tag">{s.subject}</span>
                </div>
                <button className="btn ghost sm" onClick={() => toggleRead(s.id)}>
                  {s.read ? "Mark unread" : <><Check size={13} /> Mark read</>}
                </button>
              </div>
              <div className="sub-contact-row">
                <EmailButton email={s.email} inline />
                {s.instagram && <span className="tag">@{s.instagram.replace(/^@/, "")}</span>}
              </div>
              <p>{s.message}</p>
              <span className="sub-date">{new Date(s.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
