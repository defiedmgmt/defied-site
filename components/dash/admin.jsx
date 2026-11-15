import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Pencil, Check, ChevronUp, ChevronDown, AlertTriangle, Music, Link2 } from "lucide-react";
import { ExtLink } from "../shared/ui";
import { filledSplits } from "../../lib/splits";
import { SECTIONS, ROLES, accessFor, cleanAccess, sameManager } from "../../lib/roles";
import { changedFields, saveRow } from "../app/saves";
import { canUse } from "./access";
import { findTabClient, noTabNames, shortDay } from "./helpers";
import { Area, Avatar, EmailButton, Field, PhotoUpload, SplitsEditor, splitTotal, uid } from "./ui";
import { AskCard } from "../portal/ask";
import { nameTaken, deleteClientCascade, clientDeleteAsk, NAME_TAKEN, SpotifyFill } from "./clients";
import { pctText, pctOk, fillChecklist, checklistChanges, checklistRows, checklistWhy, rowNote, changeWords } from "./manager-artists";
import { orderUsers, nextSort, sortValue, sortFromValue, SORT_OPTIONS, loadSort, saveSort, loadOpen, saveOpen } from "./users-list";
export { ClientMore, clientDeleteAsk, deleteClientCascade, NAME_TAKEN, nameTaken, SpotifyFill } from "./clients";


/* generic editable list ------------------------------------------------ */
// (2026-11-15, Site › Users) two options for a long list, both off unless given:
//   sort  { by, dir, onSort(key), value, options: [[value, words]], onPick(value) }: a column with `sort: key` gets a head button (aria-sort;
//         the list is then a table for assistive tech), and under 900px, where the head row is hidden, a "Sort:" picker
//   fold  { group, open, onToggle(), onShow() }: the rows of groupOf's `group` fold away behind their heading row, which says how many
//         there are and has a Show / Hide button; onShow() is called when a form opens for one of the folded rows
// The order of `items` is the caller's: sorting is never done here.
export function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete, openId = null, noAdd = false, openNew = null, groupOf = null, sort = null, fold = null }) {
  const [editing, setEditing] = useState(null); // object or null
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [delAsk, setDelAsk] = useState(null); // the row its Delete asks about
  const [listErr, setListErr] = useState(null); // a Delete that was refused ("There has to be at least one staff account.")
  const from = useRef(null); // the row as it was when the form opened
  // (2026-11-10) no Esc and no click outside: the window closes only with its X or Cancel, so typing isn't lost
  useEffect(() => {
    if (!editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [editing]);
  const start = (obj) => {
    from.current = obj; setFormErr(null); setEditing(obj ? { ...obj } : { id: null, ...blank });
    if (obj && fold && groupOf?.(obj) === fold.group) fold.onShow(); // a form for a folded row: its group opens, so they're there when it closes
  };
  // a link to one row (To do's "Set X's sheet tab") opens its form
  useEffect(() => { const it = openId && items.find((x) => x.id === openId); if (it) start(it); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // (2026-11-13) a new row's form opened already filled in ({ key, values }: Site › Users' "Add login" for a manager
  // on the accounting sheet); nothing is saved until Save
  useEffect(() => { if (openNew) { from.current = null; setFormErr(null); setEditing({ id: null, ...blank, ...openNew.values }); } }, [openNew?.key]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // sort turns the list into a table for assistive tech (aria-sort needs a column header in a table); otherwise no role is set
  const T = sort ? { table: "table", row: "row", cell: "cell", head: "columnheader" } : {};
  const folded = (it) => !!fold && !fold.open && groupOf?.(it) === fold.group; // a row hidden behind its group's heading
  // (2026-11-14) a heading over each group of rows (Users: "No login yet"), when groupOf gives one; the folded group's is a row with Show / Hide
  const groupHead = (it, i) => {
    const g = groupOf?.(it) || null;
    if (!g || !(i === 0 || groupOf(items[i - 1]) !== g)) return null;
    if (!fold || fold.group !== g) return <div className="admin-group" key={`group:${g}`} data-group={g}>{g}</div>;
    const n = items.filter((x) => groupOf(x) === g).length, act = fold.open ? "Hide" : "Show";
    return (
      <div className="admin-group admin-fold" key={`group:${g}`} data-group={g} data-fold={fold.open ? "open" : "closed"} role={T.row}>
        <span role={T.cell}>{g} ({n})</span>
        <span role={T.cell}><button type="button" className="btn ghost sm" onClick={fold.onToggle} aria-label={`${act} ${g} (${n})`} data-fold-toggle>{act}</button></span>
      </div>
    );
  };
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
      {sort && (
        <label className="admin-sort" data-sort-pick>
          <span>Sort:</span>
          <select value={sort.value} onChange={(ev) => sort.onPick(ev.target.value)}>
            {sort.options.map(([v, words]) => <option key={v} value={v}>{words}</option>)}
          </select>
        </label>
      )}
      <div className="admin-table" role={T.table} aria-label={sort ? title : undefined}>
        <div className={`${rowCls} admin-hd`} style={gridCols} role={T.row}>
          {columns.map((c) => {
            const on = !!sort && !!c.sort && sort.by === c.sort;
            return (
              <span key={c.key} role={T.head} aria-sort={on ? (sort.dir < 0 ? "descending" : "ascending") : undefined}>
                {sort && c.sort
                  ? <button type="button" className={on ? "ar-sort on" : "ar-sort"} onClick={() => sort.onSort(c.sort)} title={c.sortTitle} data-sort={c.sort}>{c.label}{on && <span aria-hidden="true">{sort.dir < 0 ? " ▼" : " ▲"}</span>}</button>
                  : c.label}
              </span>
            );
          })}
          <span className="admin-act" role={T.head}>Actions</span>
        </div>
        {items.length === 0 && <div className="admin-empty">Nothing here yet. Click “Add”.</div>}
        {items.map((it, i) => [groupHead(it, i), folded(it) ? null : (
          <div className={rowCls} key={it.id} style={gridCols} role={T.row}>
            {columns.map((c) => <span key={c.key} className="cell" role={T.cell}>{c.render ? c.render(it) : (it[c.key] || "—")}</span>)}
            <span className="admin-act" role={T.cell}>
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
        )])}
      </div>

      {editing && (
        <div className="modal">
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

// focus "accounting" (Site › Sync's "Add X to the sheet"): the form opens on its accounting sheet part, not the sheet tab
export function ClientsAdmin({ db, commit, openId = null, songInfo = null, reloadDb = null, focus = null }) {
  const tabFocus = !!openId && focus !== "accounting";
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
          <Field label="Sheet tab name" value={e.sheetTabName} onChange={(ev) => set({ ...e, sheetTabName: ev.target.value })} autoFocus={tabFocus && e.id === openId} data-sheet-tab=""
            hint={`${(tabFocus && e.id === openId) || noTabIds.has(e.id) ? `The pub sheet has no tab called ${db.clients.find((c) => c.id === e.id)?.sheetTabName?.trim() || db.clients.find((c) => c.id === e.id)?.name}. ` : ""}Only needed if their tab on the pub sheet goes by a different name. Case, accents, punctuation and a “!” used as an i don't count — Stack!e already finds a tab named Stackie.`} />
          {taken(e, "sheetTabName") && <p className="hint err-text">{NAME_TAKEN}</p>}
          <SheetsPart e={e} set={set} db={db} reloadDb={reloadDb} focus={focus === "accounting" && e.id === openId} />
        </>
      )}
    />
    </div>
  );
}

/* (2026-11-13) people sync: the sheets from the site (lib/people-sync.js, /api/people-sync). The owner: "i just want an
   easier way to add the managers and clients and stuff on the site and have it all sync to the sheets". A client's form
   gets its row on the accounting sheet's INFO tab (Money) and a tab on the pub sheet (Clients); Site › Users gets INFO's
   managers list. Every write is the server's, checked against the sheet first and read back after. */
// GET /api/people-sync, kept a minute for every form that opens (it costs three Google reads)
const peopleCache = { at: 0, d: null, p: null };
function usePeopleSync(on) {
  const fresh = () => (peopleCache.d && Date.now() - peopleCache.at < 60000 ? peopleCache.d : null);
  const [data, setData] = useState(fresh);
  const [failed, setFailed] = useState(false);
  const load = (force = false) => {
    if (!on) return Promise.resolve(null);
    if (!force && fresh()) { setData(fresh()); return Promise.resolve(fresh()); }
    if (!force && peopleCache.p) return peopleCache.p.then((d) => { if (d) setData(d); else setFailed(true); return d; });
    setFailed(false);
    const p = fetch("/api/people-sync", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (peopleCache.p === p) peopleCache.p = null; if (d) { peopleCache.d = d; peopleCache.at = Date.now(); setData(d); } else setFailed(true); return d; });
    peopleCache.p = p;
    return p;
  };
  useEffect(() => { load(); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, load };
}
async function peoplePost(body) {
  const r = await fetch("/api/people-sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { error: "Couldn't reach the site. Try again." };
  const j = await r.json().catch(() => ({}));
  // a refusal keeps what the form needs: stale (INFO changed since it was filled), addedManager (a new manager went on
  // INFO's list before the client's row was refused)
  return r.ok ? j : { error: j.error || "That didn't go through. Try again in a minute.", ...(j.stale ? { stale: true } : {}), ...(j.addedManager ? { addedManager: j.addedManager } : {}) };
}
const NEW_MANAGER = "__new", PICK_MANAGER = "__pick";
// a save's answer as one line: what was done, or the alarm (red), or why not
const Said = ({ res }) => (!res ? null : <p className={`hint ${res.ok && !res.alarm ? "ok-text" : "err-text"}`} role="status" data-sheet-said>{[res.text, res.alarm, res.error].filter(Boolean).join(" ")}</p>);

function SheetsPart({ e, set, db, reloadDb, focus }) {
  const money = canUse(db, "money"), pub = canUse(db, "publishing");
  const ps = usePeopleSync(money || pub);
  const box = useRef(null);
  useEffect(() => { if (focus) box.current?.scrollIntoView?.({ block: "center" }); }, [focus]);
  if (!money && !pub) return null;
  const saved = e.id && db.clients.find((c) => c.id === e.id);
  // the server writes the client as saved: an unsaved name (or sheet tab name) would go to the sheet as it was
  const unsaved = !saved ? "Save the client first." : (saved.name || "").trim() !== (e.name || "").trim() ? "Save the name change first." : null;
  return (
    <div ref={box} className="sheet-parts">
      {money && <AccountingPart client={saved || e} unsaved={unsaved} ps={ps} reloadDb={reloadDb} />}
      {pub && <TabPart client={saved || e} unsaved={unsaved || (saved && (saved.sheetTabName || "").trim() !== (e.sheetTabName || "").trim() ? "Save the sheet tab name first." : null)} ps={ps} reloadDb={reloadDb} onTab={(tab) => set({ ...e, sheetTabName: tab })} />}
    </div>
  );
}

// The client's row on INFO: Commission (D), Manager (E, from INFO's own list), Manager's cut (F)
function AccountingPart({ client, unsaved, ps, reloadDb }) {
  const d = ps.data, info = d?.info;
  const row = (info?.roster || []).find((r) => client.id && r.clientId === client.id) || null;
  const names = (info?.managers || []).map((m) => m.name);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  // (2026-11-13 review) filled from INFO as read, never a made-up figure: a blank Commission stays blank. base: the row
  // it was filled from, sent with the save (a row changed on INFO since is refused, never typed over), and each field's
  // text then, so only what was changed is sent (a cut of 66.6667% isn't rewritten as 66.67 by a commission change)
  useEffect(() => {
    if (!info || info.problem || f) return;
    const rate = row?.rate != null ? pctText(row.rate) : "", cut = row?.manager && row.cut != null ? pctText(row.cut) : "";
    const manager = !row ? PICK_MANAGER : !row.manager ? "" : names.includes(row.manager) ? row.manager : PICK_MANAGER;
    setF({ rate, manager, cut, newName: "", base: row ? { row: row.row, raw: row.raw || {}, rate, manager, cut } : null });
  }, [info, f == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const offList = row?.manager && !names.includes(row.manager);
  const hasManager = f && f.manager !== "" && f.manager !== PICK_MANAGER;
  const b = f?.base;
  const rateSent = !!f && (!b || f.rate.trim() !== b.rate);
  const cutSent = !!hasManager && (!b || f.cut.trim() !== b.cut || b.cut === "");
  const changed = !b || rateSent || cutSent || f.manager !== b.manager;
  const why = !d ? (ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…") : info?.problem ? null : unsaved
    || (!d.writes?.accounting ? d.off?.accounting : null)
    || (!f ? "Reading the accounting sheet…" : null)
    || (!b && info?.nextClientRow == null ? "INFO's client list is full (rows 4 to 43)." : null)
    || (rateSent && !pctOk(f.rate) ? "Type the commission as a number from 0 to 100." : null)
    || (f.manager === PICK_MANAGER ? "Pick a manager first." : null)
    || (f.manager === NEW_MANAGER && !f.newName.trim() ? "Type the new manager's name." : null)
    || (cutSent && !pctOk(f.cut) ? "Type the manager's cut as a number from 0 to 100." : null)
    || (!changed ? "Change something first." : null);
  const save = async () => {
    setBusy(true); setRes(null);
    const r = await peoplePost({ action: "client", clientId: client.id, mode: b ? "update" : "add", row: b?.row ?? null, was: b ? b.raw : null,
      rate: rateSent ? Number(f.rate) : null, manager: f.manager === NEW_MANAGER ? "" : f.manager, cut: cutSent ? Number(f.cut) : null, newManager: f.manager === NEW_MANAGER ? f.newName.trim() : "" });
    // INFO as it reads now, whatever the answer (a new manager may have gone on its list before a refusal)
    await ps.load(true);
    setBusy(false); setRes(r);
    if (r.ok || r.alarm || r.stale) setF(null); // filled again from INFO as it reads now
    else if (r.addedManager) setF((x) => ({ ...x, manager: r.addedManager, newName: "" }));
    if (r.ok || r.alarm) reloadDb?.();
  };
  return (
    <fieldset className="fld sheet-part" data-acct-part>
      <legend>Accounting sheet</legend>
      <p className="hint" data-acct-status>{!d ? (ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…") : info?.problem ? <span className="err-text">{info.problem}</span>
        : row ? `On the accounting sheet, row ${row.row}.` : "Not on the accounting sheet yet."}</p>
      {f && !info?.problem && (
        <>
          <label className="fld"><span>Commission %</span>
            <input inputMode="decimal" autoComplete="off" value={f.rate} aria-invalid={rateSent && !pctOk(f.rate)} onChange={(ev) => setF({ ...f, rate: ev.target.value })} data-acct-rate />
            {b && b.rate === "" && !f.rate.trim() && <span className="hint">Blank on INFO. It stays blank unless you type one.</span>}</label>
          <label className="fld"><span>Manager</span>
            <select value={f.manager} onChange={(ev) => setF({ ...f, manager: ev.target.value })} data-acct-manager>
              {f.manager === PICK_MANAGER && <option value={PICK_MANAGER} disabled>Pick one</option>}
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="">No manager (Defied keeps 100%)</option>
              <option value={NEW_MANAGER}>New manager…</option>
            </select>
            {offList && <span className="hint">INFO says {row.manager}, which isn't on its manager list.</span>}
          </label>
          {f.manager === NEW_MANAGER && <Field label="New manager's name" value={f.newName} onChange={(ev) => setF({ ...f, newName: ev.target.value })} hint="Spelled as the sheet should have it. It goes on INFO's manager list first." data-acct-new-manager="" />}
          {hasManager && (
            <div className="fld"><span>Manager's cut %</span>
              <span className="sheet-cut">
                <input inputMode="decimal" autoComplete="off" value={f.cut} aria-invalid={cutSent && !pctOk(f.cut)} aria-label="Manager's cut %" onChange={(ev) => setF({ ...f, cut: ev.target.value })} data-acct-cut />
                {["50", "67"].map((v) => <button key={v} type="button" className={`btn ghost sm${f.cut === v ? " on" : ""}`} onClick={() => setF({ ...f, cut: v })}>{v}%</button>)}
              </span>
              <span className="hint">Defied keeps the rest.</span>
            </div>
          )}
        </>
      )}
      <div className="sheet-go">
        <button type="button" className="btn sm" disabled={!!why || busy || !!info?.problem} onClick={save} data-acct-save>{busy ? "Saving…" : f?.base || (!f && row) ? "Update the accounting sheet" : "Add to the accounting sheet"}</button>
        {why && d && !info?.problem && <span className="hint">{why}</span>}
      </div>
      <Said res={res} />
    </fieldset>
  );
}

// A client with no tab on the pub sheet: a free WRITER tab, renamed for them (its MASTER row comes with it)
function TabPart({ client, unsaved, ps, reloadDb, onTab }) {
  const d = ps.data;
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  if (!d || d.noTab == null) return null;
  if (client.id && !d.noTab.includes(client.id) && !res) return null; // they have one
  const title = (client.sheetTabName || "").trim() || (client.name || "").trim();
  const why = unsaved || (!d.writes?.pub ? d.off?.pub : null) || (d.freeTabs === 0 ? "No free WRITER tab left on the pub sheet." : null);
  const go = async () => {
    setBusy(true); setRes(null);
    const r = await peoplePost({ action: "tab", clientId: client.id });
    setBusy(false); setRes(r);
    if (r.ok) { if (r.tab) onTab?.(r.tab); ps.load(true); reloadDb?.(); }
  };
  return (
    <div className="sheet-part sheet-tab-part" data-tab-part>
      {!res?.ok && <p className="hint">No tab on the pub sheet yet, so their numbers can't sync.</p>}
      {!res?.ok && (
        <div className="sheet-go">
          <button type="button" className="btn ghost sm" disabled={!!why || busy} onClick={go} data-tab-make>{busy ? "Making the tab…" : "Give them a pub sheet tab"}</button>
          <span className="hint">{why || `A free WRITER tab is renamed ${title}. Its MASTER row comes with it.`}</span>
        </div>
      )}
      <Said res={res} />
    </div>
  );
}

/* (2026-11-14) A manager's artists, ticked in one place (the owner: "can we just have like a select box for his artists and
   have that sync to the accounting sheet"). Site › Users' form for a Co-manager shows it where the read-only "Their
   artists" line was, and "Artists" on Managers on the accounting sheet opens it in a window for a manager with no login.
   Ticked = INFO's Assigned Manager is exactly this name. Save artists writes E and F of the rows changed in one go
   (lib/people-sync.js saveManagerArtists), and the site's managers follow the sheet. Its own button, apart from the
   form's Save, the way the Roster form's Accounting sheet part is: it writes the accounting sheet (its own lock, stale
   check and read-back), the form's Save writes the site. The logic is components/dash/manager-artists.js. */
function useArtistsChecklist({ manager, ps, reloadDb, onDirty, nudge = 0 }) {
  const d = ps.data, info = d?.info;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null), [held, setHeld] = useState(false);
  const goRef = useRef(null), nudged = useRef(nudge); // a nudge from before this checklist opened isn't this form's
  // filled from INFO as read; a row changed on INFO since is refused by the server, never typed over; filled again after a save
  useEffect(() => {
    if (!info || info.problem || f) return;
    setF(fillChecklist(info.roster, manager));
  }, [info, f == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const changes = checklistChanges(f);
  // the form holds its own Save while ticks are unsaved (see UsersAdmin), so a tick is never lost to the wrong button: it
  // sends a nudge, and the way to Save artists is shown here (gone as soon as nothing is unsaved)
  useEffect(() => { onDirty?.(changes.length > 0); if (!changes.length) setHeld(false); }, [changes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nudge !== nudged.current) { nudged.current = nudge; setHeld(true); goRef.current?.scrollIntoView?.({ block: "center" }); } }, [nudge]);
  const why = !d ? (ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…") : info?.problem ? null
    : !d.writes?.accounting ? d.off?.accounting : checklistWhy(f, changes, manager);
  const save = async () => {
    setBusy(true); setRes(null);
    const r = await peoplePost({ action: "manager-artists", manager, rows: checklistRows(f, changes) });
    // INFO as it reads now, whatever the answer
    await ps.load(true);
    setBusy(false); setRes(r);
    if (r.ok || r.alarm || r.stale) setF(null); // filled again from INFO as it reads now
    if (r.ok || r.alarm) reloadDb?.();
  };
  return { d, info, f, setF, changes, why, busy, res, held, save, goRef };
}
// Save artists
function ArtistsSave({ c }) {
  const { info, why, busy, save, goRef } = c;
  return <button ref={goRef} type="button" className="btn sm" disabled={!!why || busy || !!info?.problem} onClick={save} data-mgr-save>{busy ? "Saving…" : "Save artists"}</button>;
}
// what is unsaved, and why it can't be saved yet: hints beside the button in the form, a line in the window's foot
function ArtistsNotes({ c, inFoot = false }) {
  const { d, info, changes, why, held } = c;
  const quiet = why === "Change something first.", count = `${changes.length === 1 ? "1 change" : `${changes.length} changes`} not saved yet: ${changeWords(changes)}.`;
  if (inFoot) return (changes.length > 0 || (why && !quiet)) ? <span className="hint mgr-foot-note" data-mgr-changes={changes.length > 0 ? "" : undefined}>{why && !quiet ? why : count}</span> : null;
  return (
    <>
      {changes.length > 0 && <span className="hint" data-mgr-changes>{count}</span>}
      {held && changes.length > 0 && <span className="hint err-text" role="alert" data-mgr-held>The form's Save is held until these are saved. Press Save artists, or untick them back.</span>}
      {why && d && !info?.problem && <span className="hint">{why}</span>}
    </>
  );
}
// what a save answered: the line, then what changed for each artist
function ArtistsResult({ c }) {
  const { res } = c;
  return (
    <>
      <Said res={res} />
      {res?.changes?.length > 0 && <ul className="mgr-arts-done" data-mgr-done>{res.changes.map((x) => <li key={x.row}>{x.text}</li>)}</ul>}
    </>
  );
}
// c: useArtistsChecklist. actions: the Save row and the answer go under the list (the form); the window keeps them in its foot
function ManagerArtists({ manager, c, bounded = false, actions = true }) {
  const { d, info, f, setF, changes } = c;
  return (
    <fieldset className="sheet-part mgr-arts" data-mgr-artists={manager}>
      <legend>Artists on the accounting sheet</legend>
      <p className="hint">Tick the artists {manager} manages. Saving sets INFO's Assigned Manager and Manager Gets % for the ones you changed.</p>
      {!d ? <p className="hint">{c.why}</p>
        : info?.problem ? <p className="hint err-text">{info.problem}</p>
        : !f ? <p className="hint">Reading the accounting sheet…</p>
        : !f.rows.length ? <p className="hint">INFO has no artists yet.</p>
        : (
        <>
          <div className="mgr-arts-head" aria-hidden="true"><span>Artist</span><span>Manager Gets %</span></div>
          <ul className={`mgr-arts-list${bounded ? " bounded" : ""}`}>
            {f.rows.map((r) => {
              const on = !!f.on[r.row], note = rowNote(f, r.row), ch = changes.find((x) => x.row === r.row), invalid = !!ch?.send && !pctOk(f.cut[r.row]);
              return (
                <li key={r.row} className={`mgr-art${ch ? " changed" : ""}`} data-mgr-artist={r.row}>
                  <label className="mgr-art-main">
                    <input type="checkbox" checked={on} onChange={(ev) => setF({ ...f, on: { ...f.on, [r.row]: ev.target.checked } })} data-mgr-tick />
                    <span className="mgr-art-text">
                      <span className="mgr-art-name">{r.name}</span>
                      {note && <span className="mgr-art-note" data-mgr-note>{note}</span>}
                    </span>
                  </label>
                  {on && (
                    <span className="fld mgr-art-cut">
                      <input inputMode="decimal" autoComplete="off" value={f.cut[r.row]} aria-invalid={invalid} aria-label={`${r.name}: ${manager}'s cut %`}
                        onChange={(ev) => setF({ ...f, cut: { ...f.cut, [r.row]: ev.target.value } })} data-mgr-cut />
                      <span aria-hidden="true">%</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {actions && <div className="sheet-go"><ArtistsSave c={c} /><ArtistsNotes c={c} /></div>}
      {actions && <ArtistsResult c={c} />}
    </fieldset>
  );
}

// The Users form's part for a Co-manager (where "Their artists" was): their checklist when their name is exactly a name on
// INFO's manager list, else one plain line with the list's own Add to the sheet. Never a near match: "Cayden" is not on a
// list that has "Caden"; "Magnus Hale" isn't "Magnus" there, so it says what the list has and offers no second entry.
function ManagerArtistsPart({ name, ps, reloadDb, onDirty, nudge }) {
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  const d = ps.data, info = d?.info, managers = info?.managers || [];
  const near = managers.find((m) => m.name !== name && sameManager(m.name, name)); // the site's own-artists rule reads it as theirs
  const off = d && !d.writes?.accounting ? d.off?.accounting : null, full = !!d && !info?.problem && info?.nextManagerRow == null;
  const add = async () => {
    setBusy(true); setRes(null);
    const r = await peoplePost({ action: "manager", name });
    setBusy(false); setRes(r);
    if (r.ok) ps.load(true);
  };
  return (
    <>
      {!name ? <p className="hint" data-manager-artists-hint>Type their name above, exactly as INFO's manager list spells it, to pick their artists here.</p>
        : !d ? <p className="hint">{ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…"}</p>
        : info?.problem ? <p className="hint err-text">{info.problem}</p>
        : managers.some((m) => m.name === name) ? <FormArtists key={name} manager={name} ps={ps} reloadDb={reloadDb} onDirty={onDirty} nudge={nudge} />
        : (
          <p className="hint" data-manager-unlisted>{name} isn't on the accounting sheet's Managers list{near ? ` (it has ${near.name}).` : "."}
            {!near && <>{" "}<button type="button" className="inline-link" disabled={!!off || busy || full} onClick={add} data-form-add-to-sheet>{busy ? "Adding…" : "Add to the sheet"}</button></>}
            {!near && (off || full) && <span> {off || "INFO's manager list is full (L4 to L13)."}</span>}
          </p>
        )}
      <Said res={res} />
    </>
  );
}
// the form's checklist: its own Save artists under the list, a bounded box on a mouse
function FormArtists({ manager, ps, reloadDb, onDirty, nudge }) {
  const c = useArtistsChecklist({ manager, ps, reloadDb, onDirty, nudge });
  return <ManagerArtists manager={manager} c={c} bounded />;
}

// "Artists" on Managers on the accounting sheet: the same checklist in its own window, for a manager with no login. Like the
// other windows it closes only with its X or Close (no Esc, no click outside), and the page behind doesn't scroll. Save
// artists is in the foot, so it is in reach however long the list is; the answer comes to the top of the window.
function ArtistsDialog({ manager, ps, reloadDb, onClose }) {
  const c = useArtistsChecklist({ manager, ps, reloadDb });
  const body = useRef(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => { if (c.res) body.current?.scrollTo?.({ top: 0 }); }, [c.res]);
  return (
    <div className="modal" data-artists-dialog>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={`${manager}'s artists`}>
        <div className="modal-head">
          <h3>{manager}'s artists</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body" ref={body}>
          <ArtistsResult c={c} />
          <ManagerArtists manager={manager} c={c} actions={false} />
        </div>
        <div className="modal-foot">
          <ArtistsNotes c={c} inFoot />
          <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
          <ArtistsSave c={c} />
        </div>
      </div>
    </div>
  );
}

// Site › Users: INFO's managers list, each with their login (lib/roles.js sameManager, the own-artists rule: Caden is
// not Cayden). A manager with no login is fine; "Add login" only opens the new-user form, filled in. "Artists" opens the
// manager's checklist. ps: the page's one usePeopleSync (the Users form's checklist reads the same INFO).
function SheetManagers({ db, roleOf, onAddLogin, ps, reloadDb }) {
  const money = canUse(db, "money");
  const [name, setName] = useState(""), [busy, setBusy] = useState(null), [res, setRes] = useState(null), [artistsFor, setArtistsFor] = useState(null);
  if (!money) return null;
  const d = ps.data, info = d?.info, managers = info?.managers || [];
  const staff = db.users.filter((u) => u.role === "staff");
  const loginOf = (n) => staff.find((u) => sameManager(n, u.name));
  const unlisted = staff.filter((u) => roleOf(u) === "comanager" && (u.name || "").trim() && !managers.some((m) => sameManager(m.name, u.name)));
  const off = d && !d.writes?.accounting ? d.off?.accounting : null;
  const full = !!d && !info?.problem && info?.nextManagerRow == null;
  const add = async (n) => {
    setBusy(n); setRes(null);
    const r = await peoplePost({ action: "manager", name: n });
    setBusy(null); setRes(r);
    if (r.ok) { setName(""); ps.load(true); }
  };
  return (
    <section className="sheet-managers" data-sheet-managers>
      <h3>Managers on the accounting sheet</h3>
      <p className="hint">INFO's manager list: the names a client's Assigned Manager is picked from.</p>
      {!d ? <p className="hint">{ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…"}</p>
        : info?.problem ? <p className="hint err-text">{info.problem}</p> : (
        <ul className="sheet-mgr-list">
          {managers.map((m) => {
            const u = loginOf(m.name);
            return (
              <li key={m.row} className="sheet-mgr-row" data-sheet-manager={m.name}>
                <span className="sheet-mgr-who">
                  <b>{m.name}</b>
                  {u ? <span className="muted"> · {u.noLogin ? "account ready, no password yet" : `login ${u.email}`}</span>
                    : <><span className="muted"> · No account yet</span> <button type="button" className="inline-link" onClick={() => onAddLogin(m.name)} data-add-login>Add login</button></>}
                </span>
                {!db.access?.ownOnly && <button type="button" className="btn ghost sm" onClick={() => setArtistsFor(m.name)} data-manager-artists-open>Artists</button>}
              </li>
            );
          })}
          {!managers.length && <li className="muted">No names on the list yet.</li>}
        </ul>
      )}
      {d && !info?.problem && unlisted.length > 0 && (
        <>
          <p className="hint">Co-manager logins not on INFO's list:</p>
          <ul className="sheet-mgr-list">
            {unlisted.map((u) => (
              <li key={u.id} data-unlisted={u.name.trim()}><b>{u.name.trim()}</b> <button type="button" className="inline-link" disabled={!!off || !!busy || full} onClick={() => add(u.name.trim())} data-add-to-sheet>{busy === u.name.trim() ? "Adding…" : "Add to the sheet"}</button></li>
            ))}
          </ul>
        </>
      )}
      {d && !info?.problem && (
        <div className="sheet-mgr-add">
          <label className="fld"><span>Add a manager (no login)</span><input value={name} autoComplete="off" onChange={(ev) => setName(ev.target.value)} data-add-manager-name /></label>
          <button type="button" className="btn sm" disabled={!name.trim() || !!off || !!busy || full} onClick={() => add(name.trim())} data-add-manager>{busy && busy === name.trim() ? "Adding…" : "Add"}</button>
        </div>
      )}
      {(off || full) && <p className="hint">{off || "INFO's manager list is full (L4 to L13)."}</p>}
      <Said res={res} />
      {artistsFor && <ArtistsDialog manager={artistsFor} ps={ps} reloadDb={reloadDb} onClose={() => setArtistsFor(null)} />}
    </section>
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
    const o = { ...o0, splits: filledSplits(o0.splits, { client: db.clients.find((c) => c.id === o0.clientId), artist: o0.artist }) }; // what the splits editor shows: the default filled in
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
          <SplitsEditor splits={e.splits} onChange={(v) => set({ ...e, splits: v })} owner={db.clients.find((c) => c.id === e.clientId)} artist={e.artist} />
          <label className="check-row">
            <input type="checkbox" checked={!!e.notable} onChange={(ev) => set({ ...e, notable: ev.target.checked })} />
            <span>Feature as a Notable Release — shows on the artist's profile. Split data stays private.</span>
          </label>
        </>
      )}
    />
  );
}

export function TeamAdmin({ db, commit, openId = null }) {
  const cols = [
    { key: "name", label: "Name", render: (s) => <span className="cell-name"><Avatar src={s.photo} name={s.name} size={30} />{s.name}</span> },
    { key: "role", label: "Role" }, { key: "email", label: "Email" },
    // (2026-11-14, people link) like the roster's: an entry the site made for a new person stays hidden until it's shown
    { key: "visible", label: "Public", render: (s) => s.visible !== false ? <span className="badge-yes"><Check size={12} /> Live</span> : <span className="badge-no" data-team-hidden>Hidden</span> },
  ];
  const save = async (o) => {
    const staff = o.id ? db.staff.map((s) => s.id === o.id ? o : s) : [...db.staff, { ...o, id: uid() }];
    return saveRow(commit, { ...db, staff }, "staff", o.id, "team member");
  };
  const del = async (id) => commit({ ...db, staff: db.staff.filter((s) => s.id !== id) });
  return (
    <Editor title="Team" items={db.staff} columns={cols} openId={openId}
      blank={{ name: "", role: "", email: "", instagram: "", bio: "", photo: "", visible: true }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <label className="check-row" data-team-visible>
            <input type="checkbox" checked={e.visible !== false} onChange={(ev) => set({ ...e, visible: ev.target.checked })} />
            <span>Show on the team page.{e.email ? " Their email shows there too." : ""}</span>
          </label>
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
// (2026-11-10) a one-time link that lets this person choose their own password (lib/password-links.js): shown once, to copy
function PasswordLink({ userId }) {
  const [link, setLink] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true); setErr(null); setCopied(false);
    try {
      const r = await fetch("/api/auth/password-link", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ userId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't make the link.");
      setLink(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setErr("Couldn't copy: select the link and copy it."); } };
  return (
    <div className="fld pw-link" data-pw-link>
      <span>Set-password link</span>
      {link ? (
        <>
          <span className="pw-link-row"><input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Set-password link" data-pw-link-url /><button type="button" className="btn sm" onClick={copy} data-pw-link-copy>{copied ? <><Check size={13} /> Copied</> : "Copy"}</button></span>
          <span className="hint">Text it to them. It works once, for 24 hours, and signs them in after they choose a password. A new link ends this one.</span>
        </>
      ) : (
        <span className="pw-link-row"><button type="button" className="btn ghost sm" disabled={busy} onClick={make} data-pw-link-make>{busy ? "Making…" : "Make a set-password link"}</button><span className="hint">They choose their own password: nobody else sees it.</span></span>
      )}
      {err && <span className="hint err-text">{err}</span>}
    </div>
  );
}
const dayOf = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const NO_LOGIN = "No login yet"; // the heading over the people who can't sign in yet (and the group the list folds)
export function UsersAdmin({ db, commit, reloadDb, openId = null }) {
  const founder = db.access?.role === "founder";
  const anyFounder = db.users.some((u) => u.role === "staff" && u.staffRole === "founder");
  const pickOf = (u) => (u.role === "client" ? "client" : ROLES[u.staffRole] ? u.staffRole : anyFounder ? "comanager" : "founder");
  const accessOf = (u) => accessFor({ staffRole: pickOf(u), access: u.access, name: u.name }, { anyFounder: true });
  const artistsOf = (name) => db.clients.filter((c) => sameManager(c.manager, name));
  const managers = useManagers(reloadDb);
  // (2026-11-14) INFO is read once for the page: Managers on the accounting sheet and a Co-manager's checklist share it. The
  // checklist needs Money, and never an account limited to its own artists (the server refuses it: it works on every artist)
  const money = canUse(db, "money"), sheetPicks = money && !db.access?.ownOnly;
  const ps = usePeopleSync(money);
  const artistsDirty = useRef(false); // ticks in the form's checklist that Save artists hasn't written yet
  const [nudge, setNudge] = useState(0); // the form's Save was pressed while they were
  const who = (u) => {
    if (u.role === "client") return `Client · ${db.clients.find((c) => c.id === u.clientId)?.name || "no client linked"}`;
    const a = accessOf(u);
    return `${ROLES[a.role].label}${a.ownOnly ? ` · own artists (${artistsOf(u.name).length})` : ""}`;
  };
  // (2026-11-15) the heads sort the list (users-list.js orderUsers; the email column sorts by name, else email), and the people with no
  // login yet are folded behind their heading: the owner, "hidden by default in users can we have a sort feature to make it easier".
  // Both choices are remembered in this browser (a convenience: every read and write is in a try). A form for one of the folded people,
  // or someone just saved with no login yet, opens the group without being asked: that isn't remembered.
  const [sort, setSort] = useState(loadSort);
  const [open, setOpen] = useState(loadOpen);
  const pickSort = (next) => { setSort(next); saveSort(next); };
  const toggleFold = () => { setOpen(!open); saveOpen(!open); };
  const cols = [
    { key: "email", label: "Email", sort: "name", sortTitle: "Sort by name", render: (u) => <span className="cell-name">{u.email || u.name || "No name"}{u.email && u.name ? <span className="muted"> · {u.name}</span> : null}</span> },
    { key: "role", label: "Access", sort: "access", sortTitle: "Sort by access", render: (u) => <span data-user-access={u.id}>{who(u)}</span> },
    // (2026-11-10) who's set up: their last sign-in and when their password was last set
    { key: "signin", label: "Sign-in", sort: "signin", sortTitle: "Sort by last sign-in", render: (u) => <span className="muted" data-user-signin={u.id}>{u.noLogin ? (u.email ? "No password yet" : "No email yet") : u.lastLoginAt ? `Last in ${dayOf(u.lastLoginAt)}` : "Never signed in"}{u.passwordChangedAt ? ` · password set ${dayOf(u.passwordChangedAt)}` : ""}</span> },
  ];
  // (2026-11-14, people link) the people with no login yet (no email or no password) come last, under their own heading;
  // each group in the order chosen (the order given when none is), for showing only: saves below use db.users as it is
  const usersShown = orderUsers(db.users, sort.by, sort.dir, pickOf);
  const save = async (o) => {
    // the checklist has its own Save artists (it writes the accounting sheet); this Save writes the site, so ticks left
    // unsaved hold it (the window stays open) and the checklist says why, never lost with the window
    if (artistsDirty.current) { setNudge((n) => n + 1); return false; }
    // (2026-11-14) no password is a person with no login yet (a set-password link later); a password needs an email
    if ((o.password || "").trim() && !(o.email || "").trim()) return "Add their email first: a password needs an email to sign in with.";
    // (what the list shows until the next load: noLogin isn't saved, the server works it out)
    const typedIn = (o.password || "").trim() && (o.email || "").trim(), noEmail = !(o.email || "").trim();
    const shown = { ...o, noLogin: o.id ? (typedIn ? false : noEmail ? true : !!o.noLogin) : !typedIn };
    const users = o.id ? db.users.map((u) => u.id === o.id ? shown : u) : [...db.users, { ...shown, id: uid() }];
    if (!users.some((u) => u.role === "staff" && (u.email || "").trim() && (!u.noLogin || (u.password || "").trim()))) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    const saved = await saveRow(commit, { ...db, users }, "users", o.id, "user");
    // (2026-11-15) someone saved who has no login yet (just added by hand, or an email taken off): show their group, so they aren't lost in the fold
    if (saved && typeof saved !== "string" && shown.noLogin) setOpen(true);
    return saved;
  };
  const del = async (id) => {
    const users = db.users.filter((u) => u.id !== id);
    if (!users.some((u) => u.role === "staff" && !u.noLogin)) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    await commit({ ...db, users });
  };
  const setPick = (e, set, v) => set({ ...e, role: v === "client" ? "client" : "staff", staffRole: v === "client" ? null : v,
    access: v === "comanager" && e.access?.ownOnly === false ? { ownOnly: false } : {} });
  const setSection = (e, set, k, on) => set({ ...e, access: cleanAccess(pickOf(e), { ...e.access, sections: { ...(e.access?.sections || {}), [k]: on } }) });
  // (2026-11-13) "Add login" for a manager on the accounting sheet: the new-user form, their name and Co-manager filled in
  const [newUser, setNewUser] = useState(null);
  const addLogin = (name) => setNewUser({ key: Date.now(), values: { name, role: "staff", staffRole: "comanager", access: {} } });
  return (
    <>
    <Editor title="Users" items={usersShown} columns={cols} groupOf={(u) => (u.noLogin ? NO_LOGIN : null)} openId={openId}
      sort={{ by: sort.by, dir: sort.dir, onSort: (by) => pickSort(nextSort(sort, by)), value: sortValue(sort), options: SORT_OPTIONS, onPick: (v) => pickSort(sortFromValue(v)) }}
      fold={{ group: NO_LOGIN, open, onToggle: toggleFold, onShow: () => setOpen(true) }}
      blank={{ email: "", password: "", role: "staff", staffRole: "comanager", access: {}, name: "", clientId: null }}
      onSave={save} onDelete={del} openNew={newUser}
      extra={(e, set) => {
        const pick = pickOf(e), a = e.role === "staff" ? accessOf(e) : null, mine = a?.ownOnly ? artistsOf(e.name) : [];
        return (
        <>
          <Field label="Email" value={e.email || ""} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field label="Name" value={e.name || ""} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field
            label="Password" value={e.password} onChange={(ev) => set({ ...e, password: ev.target.value })}
            hint={e.id ? "Leave blank to keep their current password, or make them a set-password link below. At least 8 characters if you type a new one." : "Leave it blank for no login yet: send a set-password link later (they need an email first). Or type one: at least 8 characters."}
          />
          {e.id && founder && (db.users.find((u) => u.id === e.id)?.email ? <PasswordLink userId={e.id} /> : <p className="hint" data-pw-link-noemail>No login yet: add their email and save, then make them a set-password link.</p>)}
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
              <input type="checkbox" checked={!!a?.ownOnly} onChange={(ev) => set({ ...e, access: cleanAccess("comanager", { ...e.access, ownOnly: ev.target.checked }) })} />
              <span>Only their own artists: the ones with this name as Assigned Manager on the accounting sheet's INFO tab.</span>
            </label>
          )}
          {pick === "comanager" && sheetPicks
            ? <ManagerArtistsPart name={(e.name || "").trim()} ps={ps} reloadDb={reloadDb} onDirty={(v) => { artistsDirty.current = v; }} nudge={nudge} />
            : a?.ownOnly && (
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
              <p className="hint">{ROLES[pick].label} starts with {pick === "founder" ? "everything" : pick === "comanager" ? "Clients (their own artists) and A&R, with no money" : "Site only"}. Tick or untick to change it for this person.</p>
            </fieldset>
          )}
          <p className="hint">Clients only see their own placements and splits. They can never edit the website.</p>
        </>
        );
      }}
    />
    {founder && <p className="hint users-managers" data-managers-at>Each artist's manager comes from the accounting sheet's INFO tab{managers.at ? `, read ${shortDay(managers.at)}` : ""}. <button type="button" className="inline-link" onClick={managers.update} disabled={managers.busy}>{managers.busy ? "Reading the sheet…" : "Update from the sheet"}</button>{managers.err && <span className="err-text"> {managers.err}</span>}</p>}
    <SheetManagers db={db} roleOf={pickOf} onAddLogin={addLogin} ps={ps} reloadDb={reloadDb} />
    </>
  );
}

// (2026-11-10) music files on website messages: Dropbox's connection, for Founders (lib/dropbox.js)
function DropboxLine({ founder }) {
  const [st, setSt] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const back = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("dropbox") : null;
  const load = () => fetch("/api/dropbox/connect?status=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  const off = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/dropbox/connect", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "disconnect" }) }).catch(() => null);
    if (!r?.ok) setErr("Couldn't disconnect. Try again."); await load(); setBusy(false);
  };
  if (!st) return null;
  const said = { connected: "Dropbox is connected.", cancelled: "Dropbox wasn't connected (cancelled).", expired: "That took too long. Press Connect Dropbox again.", failed: "Dropbox didn't connect. Try again.", founders: "Only a Founder can connect Dropbox." }[back];
  return (
    <p className="hint dropbox-line" data-dropbox={st.connected ? "on" : "off"}>
      <Music size={14} />{" "}
      {st.connected ? <>Music files from the website go to Dropbox › Apps › Defied Submissions{st.by ? ` (connected by ${st.by})` : ""}.</> : <>Music files on the website form are off until Dropbox is connected.</>}
      {founder && (st.connected
        ? <> <button type="button" className="inline-link" disabled={busy} onClick={off} data-dropbox-off>Disconnect</button></>
        : <> <a className="btn sm" href="/api/dropbox/connect" data-dropbox-connect>Connect Dropbox</a></>)}
      {said && <span className={back === "connected" ? " ok-text" : " err-text"}> {said}</span>}
      {err && <span className="err-text"> {err}</span>}
    </p>
  );
}
const fileSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
// a Dropbox shared link as something the page can play (raw=1 serves the file itself)
const playUrl = (u) => { try { const x = new URL(u); x.searchParams.delete("dl"); x.searchParams.set("raw", "1"); return x.toString(); } catch { return u; } };
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
      <DropboxLine founder={db.access?.role === "founder"} />
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
                {s.musicLink && <ExtLink href={s.musicLink} className="tag sub-link"><Link2 size={12} /> Music link</ExtLink>}
              </div>
              <p>{s.message}</p>
              {(s.files?.length > 0 || s.filesStatus === "uploading" || s.filesStatus === "failed") && (
                <div className="sub-files" data-sub-files={s.filesStatus}>
                  {s.filesStatus === "uploading" ? <span className="hint">Files still uploading…</span>
                    : s.files?.length ? s.files.map((f) => f.url ? (
                      // (2026-11-10) each file plays right here; its name opens it in Dropbox
                      <div key={f.url} className="sub-file" data-sub-file>
                        <span className="sub-file-top"><Music size={13} /><ExtLink href={f.url} className="sub-file-name">{f.name}</ExtLink><em>{fileSize(f.size)}</em></span>
                        <audio controls preload="none" src={playUrl(f.url)} data-sub-audio />
                      </div>
                    ) : null)
                    : <span className="hint">The files didn't arrive.</span>}
                </div>
              )}
              <span className="sub-date">{new Date(s.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
