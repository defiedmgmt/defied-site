import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Pencil, Check, ChevronUp, ChevronDown, AlertTriangle, Music, Link2 } from "lucide-react";
import { ExtLink } from "../shared/ui";
import { filledSplits } from "../../lib/splits";
import { SECTIONS, ROLES, accessFor, cleanAccess, sameManager, roleOf, teamAccountOf } from "../../lib/roles";
import { changedFields, saveRow } from "../app/saves";
import { canUse } from "./access";
import { findTabClient, noTabNames, shortDay } from "./helpers";
import { Area, Avatar, EmailButton, Field, PhotoUpload, SplitsEditor, splitTotal, uid } from "./ui";
import { AskCard } from "../portal/ask";
import { nameTaken, deleteClientCascade, clientDeleteAsk, NAME_TAKEN, SpotifyFill } from "./clients";
import { pctText, pctOk, SPLITS, splitOf, FOUNDER_LINE, founderNames, isFounderManager, clientCut, nowLine, refillChecklist, checklistChanges, checklistRows, checklistWhy, rowNote, changeWords, nearManager, artistsPart, sheetSteps, pickNote, pickRows, savedLine, notSavedLine, tickRow } from "./manager-artists";
import { hasMyTodo, hasMyPay } from "../../lib/own-pages";
import { orderUsers, nextSort, sortWords, SORT_CHOICES, loadSort, saveSort, loadOpen, saveOpen, sheetOnlyManagers } from "./users-list";
import { usePeopleSync, peoplePost, Said, AddedSaid, syncEverywhere } from "./people-added";
export { ClientMore, clientDeleteAsk, deleteClientCascade, NAME_TAKEN, nameTaken, SpotifyFill } from "./clients";


/* generic editable list ------------------------------------------------ */
// (2026-11-15, Site › Users) options for a long list, all off unless given:
//   sort  { by, dir, onSort(key), choices: [[key, words]] }: a "Sort by" control above the table (a segmented control: the one in force has
//         an arrow, pressing it again reverses), and a column with `sort: key` gets a head button too (aria-sort; the list is then a table for
//         assistive tech)
//   fold  { group, open, onToggle(), onShow() }: the rows of groupOf's `group` fold away behind their heading row, which says how many
//         there are and has a Show / Hide button; onShow() is called when a form opens for one of the folded rows
//   draftOf(row)  values | null: a row that isn't saved yet (INFO's manager with no account): its Edit opens a NEW row's form filled with
//         these values, and it has no Delete
//   notice  a node under the heading: the line after a save ("Added everywhere: …")
// onSave may answer { stay: line, id }: the row WAS saved but the form has more to say (a sheet part that was refused); it stays open, now the
// saved row's form, with the line. The order of `items` is the caller's: sorting is never done here.
export function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete, openId = null, noAdd = false, groupOf = null, sort = null, fold = null, draftOf = null, notice = null }) {
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
    const draft = obj && draftOf ? draftOf(obj) : null; // not a saved row: a new row's form, filled in
    from.current = draft ? null : obj; setFormErr(null); setEditing(draft ? { id: null, ...blank, ...draft } : obj ? { ...obj } : { id: null, ...blank });
    if (obj && !draft && fold && groupOf?.(obj) === fold.group) fold.onShow(); // a form for a folded row: its group opens, so they're there when it closes
  };
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
      else if (ok && ok.stay) { // saved, with more to say: the form stays, as the saved row's, and a retry sends only what changes after this
        const id = ok.id ?? editing.id;
        from.current = { ...editing, id }; setEditing((x) => ({ ...x, id })); setFormErr(ok.stay);
      } else if (ok !== false) setEditing(null);
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
      {notice}
      {ask && (
        <AskCard title={ask.title} goLabel={ask.goLabel} busyLabel="Deleting…" typeName={ask.typeName} onClose={() => setDelAsk(null)}
          go={async () => { const r = await onDelete(delAsk.id); setDelAsk(null); setListErr(typeof r === "string" ? r : null); }}>
          <p>{ask.body}</p>
        </AskCard>
      )}
      {sort && (
        <div className="admin-sort" data-sort-pick>
          <span className="admin-sort-label" id="admin-sort-label">Sort by</span>
          <span className="gainer-tabs" role="group" aria-labelledby="admin-sort-label">
            {sort.choices.map(([key, words]) => {
              const on = sort.by === key;
              return (
                <button key={key} type="button" className={on ? "active" : undefined} aria-pressed={on} onClick={() => sort.onSort(key)} data-sort-choice={key}
                  title={on ? `${words}, ${sortWords(key, sort.dir)}. Press again to reverse.` : `Sort by ${words.toLowerCase()}`}>
                  {words}{on && <span aria-hidden="true">{sort.dir < 0 ? " ▼" : " ▲"}</span>}
                </button>
              );
            })}
          </span>
        </div>
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
              {onDelete && !(draftOf && draftOf(it)) && <button onClick={() => remove(it)} aria-label={`Delete ${it.name || it.song || it.email || "entry"}`}><Trash2 size={14} /></button>}
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
export function ClientsAdmin({ db, commit, openId = null, songInfo = null, reloadDb = null, focus = null, onGo = null }) {
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
  const [said, setSaid] = useState(null); // the line after a client was ADDED: everywhere at once, hidden (people-added.jsx)
  // only a name/tab being changed is checked, so an older pair that already clashes still saves other edits
  const taken = (e, key) => (e[key] || "") !== (db.clients.find((c) => c.id === e.id)?.[key] || "") && nameTaken(db.clients, e.id, e[key]);
  const save = async (o) => {
    if (taken(o, "name") || taken(o, "sheetTabName")) return false; // the form stays open, saying why
    const id = o.id || uid();
    const clients = o.id ? db.clients.map((c) => c.id === o.id ? o : c) : [...db.clients, { ...o, id }];
    const saved = await saveRow(commit, { ...db, clients }, "clients", o.id, "client");
    // (2026-11-15) a client ADDED is put everywhere at once: their client login and INFO row (commission left blank), the roster hidden
    if (saved && typeof saved !== "string" && !o.id) setSaid(await syncEverywhere({ kind: "client", id, name: (o.name || "").trim() }, reloadDb));
    return saved;
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
      confirmDelete={(c) => clientDeleteAsk(db, c)} notice={<AddedSaid said={said} onGo={onGo} />}
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

// (2026-11-13) people sync: a client's form gets its row on the accounting sheet's INFO tab (Money) and a tab on the pub sheet
// (Clients); the shared read, posts and lines are components/dash/people-added.jsx
const NEW_MANAGER = "__new", PICK_MANAGER = "__pick";

// (2026-11-16, the owner: "their cut is confusing") a manager's cut is one of two splits, as a pair of buttons with "Manager / Defied" beside them
// (components/dash/manager-artists.js SPLITS). value: the pct picked ("66.7" or "50"), "" when neither is. A client's accounting part and a person's artists use it
function SplitPick({ value, onPick, disabled = false, label, ...rest }) {
  return (
    <span className="sheet-cut split-pick" role="group" aria-label={label} {...rest}>
      {SPLITS.map((s) => <button key={s.pct} type="button" className={`btn ghost sm${value === s.pct ? " on" : ""}`} aria-pressed={value === s.pct} disabled={disabled} onClick={() => onPick(s.pct)} data-split={s.pct}>{s.label}</button>)}
      <span className="split-cap">Manager / Defied</span>
    </span>
  );
}

function SheetsPart({ e, set, db, reloadDb, focus }) {
  const money = canUse(db, "money"), pub = canUse(db, "publishing");
  const ps = usePeopleSync(money || pub);
  const box = useRef(null);
  useEffect(() => { if (focus) box.current?.scrollIntoView?.({ block: "center" }); }, [focus]);
  if (!money && !pub) return null;
  const founders = founderNames(db.users); // a manager who is a Founder has no cut to pick (AccountingPart): Defied keeps the whole commission
  const saved = e.id && db.clients.find((c) => c.id === e.id);
  // the server writes the client as saved: an unsaved name (or sheet tab name) would go to the sheet as it was
  const unsaved = !saved ? "Save the client first." : (saved.name || "").trim() !== (e.name || "").trim() ? "Save the name change first." : null;
  return (
    <div ref={box} className="sheet-parts">
      {money && <AccountingPart client={saved || e} unsaved={unsaved} ps={ps} reloadDb={reloadDb} founders={founders} />}
      {pub && <TabPart client={saved || e} unsaved={unsaved || (saved && (saved.sheetTabName || "").trim() !== (e.sheetTabName || "").trim() ? "Save the sheet tab name first." : null)} ps={ps} reloadDb={reloadDb} onTab={(tab) => set({ ...e, sheetTabName: tab })} />}
    </div>
  );
}

// The client's row on INFO: Commission (D), Manager (E, from INFO's own list), Manager's cut (F). founders: the Founders' account names: their artists have no cut to pick
// (Defied keeps the whole commission: F is 0), the cut is picked from the two splits for anyone else (components/dash/manager-artists.js clientCut)
function AccountingPart({ client, unsaved, ps, reloadDb, founders = [] }) {
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
    // (2026-11-15) a client not on INFO yet starts at 20% (the owner: "commission is always going to be 20 percent"; lib/people-sync.js
    // DEFAULT_COMMISSION); a row whose D is blank stays blank until one is typed
    // (2026-11-16) the manager's cut is one of two splits (66.7 / 33.3, 50 / 50): split is the one INFO holds ("" when it holds neither: the form says what it holds, and leaves it)
    const rate = row?.rate != null ? pctText(row.rate) : row ? "" : "20", cut = row?.manager && row.cut != null ? pctText(row.cut) : "";
    // zero: F is 0 now (a Founder's artist); infoManager: INFO's E now (a manager that isn't on its list leaves the select on "Pick one", but is still what INFO has)
    const split = row?.manager ? splitOf(row.cut) : "", zero = !!row?.manager && typeof row.cut === "number" && Math.abs(row.cut) <= 1e-9;
    const manager = !row ? PICK_MANAGER : !row.manager ? "" : names.includes(row.manager) ? row.manager : PICK_MANAGER;
    setF({ rate, manager, cut: split, newName: "", base: row ? { row: row.row, raw: row.raw || {}, rate, manager, cut, split, zero, infoManager: row.manager || "" } : null });
  }, [info, f == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const offList = row?.manager && !names.includes(row.manager);
  const hasManager = f && f.manager !== "" && f.manager !== PICK_MANAGER;
  const b = f?.base;
  const rateSent = !!f && (!b || f.rate.trim() !== b.rate);
  // the manager picked (a typed new one counts by its name), and what Save sends for the cut: a Founder's artist is 0, anyone else's one of the two splits
  const mgrName = !f ? "" : f.manager === NEW_MANAGER ? f.newName.trim() : f.manager;
  const founderPick = !!hasManager && isFounderManager(founders, mgrName);
  const cc = hasManager ? clientCut({ founder: founderPick, row: b ? { cut: b.cut, split: b.split, zero: b.zero, manager: b.infoManager } : null, picked: f.cut, manager: mgrName }) : { send: false, cut: null, pick: false };
  const cutSent = cc.send;
  const changed = !b || rateSent || cutSent || f.manager !== b.manager;
  const why = !d ? (ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…") : info?.problem ? null : unsaved
    || (!d.writes?.accounting ? d.off?.accounting : null)
    || (!f ? "Reading the accounting sheet…" : null)
    || (!b && info?.nextClientRow == null ? "INFO's client list is full (rows 4 to 43)." : null)
    || (rateSent && !pctOk(f.rate) ? "Type the commission as a number from 0 to 100." : null)
    || (f.manager === PICK_MANAGER ? "Pick a manager first." : null)
    || (f.manager === NEW_MANAGER && !f.newName.trim() ? "Type the new manager's name." : null)
    || (cc.pick ? "Pick the manager's cut (66.7 / 33.3 or 50 / 50)." : null)
    || (!changed ? "Change something first." : null);
  const save = async () => {
    setBusy(true); setRes(null);
    const r = await peoplePost({ action: "client", clientId: client.id, mode: b ? "update" : "add", row: b?.row ?? null, was: b ? b.raw : null,
      rate: rateSent ? Number(f.rate) : null, manager: f.manager === NEW_MANAGER ? "" : f.manager, cut: cutSent ? cc.cut : null, newManager: f.manager === NEW_MANAGER ? f.newName.trim() : "" });
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
          {founderPick && <p className="hint" data-acct-founder>{FOUNDER_LINE}</p>}
          {hasManager && !founderPick && (
            <div className="fld"><span>Manager's cut</span>
              <SplitPick value={f.cut} label="Manager's cut" onPick={(v) => setF({ ...f, cut: v })} data-acct-cut="" />
              {b && b.cut !== "" && !b.split && <span className="hint" data-acct-cut-now>Now {b.cut}% on the sheet</span>}
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
   have that sync to the accounting sheet"). (2026-11-15, one place) it is part of the person's own form in Site › Users, for a
   Co-manager or a Founder, and the form's ONE Save writes it: the owner, "i wanted to be in each users account that i can choose
   their clients and stuff idk why its 2 separate things rn", "default at the clients that manager represents if its known but like
   there shld be an option to select more". So their artists are chips (INFO's Assigned Manager is exactly this name), each with a ×,
   and "+ Add artists" opens the rest of INFO's artists to pick from, with who has them now. (2026-11-16) "Their cut" is one of two
   splits for all of them (66.7 / 33.3 or 50 / 50); a Founder's artists have none (Defied keeps the whole commission: they go in at 0).
   Save writes E and F of the rows changed in one go (lib/people-sync.js saveManagerArtists) after the account is saved, and the
   site's managers follow the sheet. The logic is components/dash/manager-artists.js. */
function useArtistsChecklist({ manager, ps, founder }) {
  const d = ps.data, info = d?.info;
  const [f, setF] = useState(null);
  const carry = useRef(null); // the checklist as it was, when a refused save has it filled again with the ticks put back on it
  // filled from INFO as read; a row changed on INFO since is refused by the server, never typed over; filled again after a save
  useEffect(() => {
    if (!info || info.problem || f) return;
    setF(refillChecklist(info.roster, manager, carry.current)); carry.current = null;
  }, [info, f == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const changes = checklistChanges(f, founder);
  const off = d && !d.writes?.accounting ? d.off?.accounting : null; // writing to the sheet isn't switched on: the account alone is saved
  return { d, info, f, setF, changes, off, carry };
}

// The Users form's part for a Co-manager or a Founder: "Their artists". pick: the form's role; name: the form's name, trimmed;
// reg: UsersAdmin's ref, which this fills with what the form's Save sends (components/dash/manager-artists.js sheetSteps)
function TheirArtists({ pick, name, ps, reg, reloadDb }) {
  const d = ps.data, info = d?.info, managers = info?.managers || [];
  const part = !name ? "name" : !d || info?.problem ? null : artistsPart(pick, true, managers, name);
  const near = part === "near" ? nearManager(managers, name) : null;
  return (
    <fieldset className="sheet-part mgr-arts" data-their-artists data-mgr-artists={part === "listed" || part === "new" ? name : undefined}>
      <legend>Their artists</legend>
      {part === "name" ? <p className="hint" data-manager-artists-hint>Type their name above to pick their artists here.</p>
        : !d ? <p className="hint">{ps.failed ? "Couldn't read the accounting sheet just now." : "Reading the accounting sheet…"}</p>
        : info?.problem ? <p className="hint err-text">{info.problem}</p>
        : part === "near" ? <p className="hint" data-manager-unlisted>{name} isn't on the accounting sheet's Managers list (it has {near.name}).</p>
        : <ArtistsBox key={name} manager={name} part={part} pick={pick} ps={ps} reg={reg} reloadDb={reloadDb} />}
    </fieldset>
  );
}

// the chips, "+ Add artists", and what Save will do. Registers in `reg` what the form's Save needs, and runs it (send)
function ArtistsBox({ manager, part, pick, ps, reg, reloadDb }) {
  const founder = pick === "founder"; // a Founder's artists have no cut to pick: Defied keeps the whole commission (they go in at 0)
  const c = useArtistsChecklist({ manager, ps, founder });
  const { info, f, setF, changes, off, carry } = c;
  const [adding, setAdding] = useState(false), [typed, setTyped] = useState("");
  const owner = useRef({}).current;
  const steps = off ? [] : sheetSteps(part, pick, changes.length);
  const block = !off && changes.length ? checklistWhy(f, changes, founder) : null; // artists to add and no split picked holds the whole Save
  const full = part === "new" && info?.nextManagerRow == null;
  // what the form's Save does with the sheet: the manager's name onto INFO's list (a Co-manager who isn't on it yet), then the changed
  // ticks. Answers { texts, alarm } (what went through), or { error, texts } (the first thing refused; nothing after it was sent)
  const send = async () => {
    const texts = [];
    let r = null, alarm = null;
    if (steps.includes("manager")) {
      r = await peoplePost({ action: "manager", name: manager });
      if (r.alarm) alarm = r.alarm;
      else if (r.error) { await ps.load(true); return { error: r.error, texts }; }
      else texts.push(`${manager} is on INFO's manager list now (L${r.row}).`);
    }
    if (!alarm && steps.includes("manager-artists")) {
      r = await peoplePost({ action: "manager-artists", manager, rows: checklistRows(f, changes, founder) });
      // INFO as it reads now, whatever the answer
      await ps.load(true);
      if (r.error) {
        if (r.stale) { carry.current = f; setF(null); } // filled again from INFO as it reads now, their ticks put back on it
        return { error: r.error, texts };
      }
      if (r.alarm && !r.ok) alarm = r.alarm;
      else { if (r.text) texts.push(r.text); if (r.alarm) alarm = r.alarm; setF(null); } // filled again from INFO as it reads now
    } else await ps.load(true);
    reloadDb?.();
    return { texts, alarm };
  };
  // the owner's ref is read by Save: set after every render, so it always has this render's checklist
  useEffect(() => { reg.current = { owner, steps, block, send }; });
  useEffect(() => () => { if (reg.current?.owner === owner) reg.current = null; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = f ? f.rows.filter((r) => f.on[r.row]) : [], more = pickRows(f, typed);
  const untick = (row) => setF({ ...f, on: { ...f.on, [row]: false } });
  const tick = (row) => setF(tickRow(f, row));
  const now = nowLine(f); // what INFO has for their artists, while they aren't all on one split and none is picked
  return (
    <>
      <p className="hint">{off ? off : `Their artists are the ones INFO lists with ${manager} as Assigned Manager. Save writes what you change to the accounting sheet.`}</p>
      {part === "new" && !off && !full && <p className="hint" data-manager-new>{manager} isn't on the accounting sheet's Managers list yet. {pick === "comanager" ? "Save adds them." : "Save adds them if you give them an artist."}</p>}
      {part === "new" && !off && full && <p className="hint err-text" data-manager-full>INFO's manager list is full (L4 to L13), so {manager} can't be added.</p>}
      {!f ? <p className="hint">Reading the accounting sheet…</p> : (
        <>
          <div className="fld mgr-their" data-mgr-their>
            {founder ? <p className="hint" data-mgr-founder>{FOUNDER_LINE}</p> : (
              <>
                <span>Their cut</span>
                <SplitPick value={f.theirCut} disabled={!!off} label={`${manager}'s cut`} onPick={(v) => setF({ ...f, theirCut: v })} data-mgr-their-cut="" />
                {now && <span className="hint" data-mgr-now>{now}</span>}
              </>
            )}
          </div>
          {chips.length > 0 && (
            <ul className="mgr-chips" data-mgr-chips>
              {chips.map((r) => {
                const ch = changes.find((x) => x.row === r.row), note = rowNote(f, r.row, ch?.kind);
                return (
                  <li key={r.row} className={`mgr-chip${ch ? " changed" : ""}`} data-mgr-artist={r.row}>
                    <span className="mgr-chip-text">
                      <span className="mgr-art-name">{r.name}</span>
                      {note && <span className="mgr-art-note" data-mgr-note>{note}</span>}
                    </span>
                    <button type="button" className="mgr-chip-x" onClick={() => untick(r.row)} disabled={!!off} aria-label={`Take ${r.name} off ${manager}`} title="Take off" data-mgr-remove><X size={14} /></button>
                  </li>
                );
              })}
            </ul>
          )}
          {!chips.length && !adding && <p className="hint" data-mgr-none>No artists yet.</p>}
          {!off && (
            <div className="mgr-add">
              <button type="button" className="btn ghost sm" onClick={() => { setAdding(!adding); setTyped(""); }} aria-expanded={adding} data-mgr-add>{adding ? "Done adding" : <><Plus size={14} /> Add artists</>}</button>
              {adding && (
                <div className="mgr-pick" data-mgr-pick>
                  <input type="search" className="mgr-search" value={typed} onChange={(ev) => setTyped(ev.target.value)} placeholder="Search artists" aria-label="Search artists" autoComplete="off" data-mgr-search />
                  <ul className="mgr-pick-list">
                    {more.map((r) => (
                      <li key={r.row}>
                        <button type="button" className="mgr-pick-row" onClick={() => tick(r.row)} data-mgr-pick-row={r.row}>
                          <span className="mgr-art-name">{r.name}</span>
                          <span className="mgr-art-note" data-mgr-pick-note>{pickNote(f, r.row)}</span>
                        </button>
                      </li>
                    ))}
                    {!more.length && <li className="hint">{typed.trim() ? "No artist by that name." : "That's every artist."}</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          {changes.length > 0 && <p className="hint" data-mgr-changes>{changes.length === 1 ? "1 change" : `${changes.length} changes`} not saved yet: {changeWords(changes)}. Save writes {changes.length === 1 ? "it" : "them"} to the accounting sheet.</p>}
          {block && <p className="hint err-text" data-mgr-block>{block.charAt(0).toUpperCase() + block.slice(1)}</p>}
        </>
      )}
    </>
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

// (2026-11-15) Site › Team's "Account": the account a team entry gets from the people link. A NEW entry (or an old one with no account yet) picks: Manager
// (a Co-manager account, on INFO's manager list), Intern (an Intern account, not on INFO) or No account; it starts at what the entry's Role text says
// (lib/roles.js teamAccountOf: "Artist Manager" is a Manager, "Designer" an Intern). An entry that has an account already shows its role, read only.
const ACCOUNT_WORDS = {
  comanager: "A Co-manager account with no login yet, and a place on the accounting sheet's manager list.",
  intern: "An Intern account with no login yet (A&R and Site). Not on the accounting sheet.",
  none: "No account is made for them, now or later.",
};
function TeamAccount({ e, set, db }) {
  if (e.id && e.userId) {
    const u = db.users.find((x) => x.id === e.userId);
    return <p className="hint" data-team-account>{u ? `Account: ${ROLES[roleOf(u.staffRole, true)].label}${u.noLogin ? ", no login yet" : ""}.` : "Account: they have one."} Change it in Site › Users.</p>;
  }
  // a new entry starts at its Role text's; an old one with no account yet (nobody has said) asks, so it is never made one by default
  const value = e.account || (e.id ? "" : teamAccountOf(e.role));
  return (
    <label className="fld"><span>Account</span>
      <select value={value} onChange={(ev) => set({ ...e, account: ev.target.value })} data-team-account-pick>
        {!value && <option value="" disabled>Pick one</option>}
        <option value="comanager">Manager</option>
        <option value="intern">Intern</option>
        <option value="none">No account</option>
      </select>
      <span className="hint" data-team-account-words>{value ? ACCOUNT_WORDS[value] : "No account has been picked for them: until one is, none is made."}</span>
    </label>
  );
}
export function TeamAdmin({ db, commit, openId = null, reloadDb = null, onGo = null }) {
  const [said, setSaid] = useState(null); // the line after a team entry was ADDED: its account and INFO's manager list too, hidden (people-added.jsx)
  const cols = [
    { key: "name", label: "Name", render: (s) => <span className="cell-name"><Avatar src={s.photo} name={s.name} size={30} />{s.name}</span> },
    { key: "role", label: "Role" }, { key: "email", label: "Email" },
    // (2026-11-14, people link) like the roster's: an entry the site made for a new person stays hidden until it's shown
    { key: "visible", label: "Public", render: (s) => s.visible !== false ? <span className="badge-yes"><Check size={12} /> Live</span> : <span className="badge-no" data-team-hidden>Hidden</span> },
  ];
  const save = async (o) => {
    const id = o.id || uid();
    // a new entry always sends its Account (the Role text's when it wasn't touched); an old one only when it was changed
    const row = !o.id ? { ...o, id, account: o.account || teamAccountOf(o.role) } : { ...o, id };
    const staff = o.id ? db.staff.map((s) => s.id === o.id ? row : s) : [...db.staff, row];
    const saved = await saveRow(commit, { ...db, staff }, "staff", o.id, "team member");
    // (2026-11-15) an entry ADDED (or given an account) is put everywhere at once: the account it said, and INFO's manager list for a Manager
    if (saved && typeof saved !== "string" && (!o.id || row.account)) setSaid(await syncEverywhere({ kind: "team", id, name: (o.name || "").trim(), account: row.account }, reloadDb));
    return saved;
  };
  const del = async (id) => commit({ ...db, staff: db.staff.filter((s) => s.id !== id) });
  return (
    <Editor title="Team" items={db.staff} columns={cols} openId={openId} notice={<AddedSaid said={said} onGo={onGo} />}
      blank={{ name: "", role: "", email: "", instagram: "", bio: "", photo: "", visible: false }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <label className="check-row" data-team-visible>
            <input type="checkbox" checked={e.visible !== false} onChange={(ev) => set({ ...e, visible: ev.target.checked })} />
            <span>Show on the team page.{e.email ? " Their email shows there too." : ""}</span>
          </label>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field label="Role" value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })} />
          <TeamAccount e={e} set={set} db={db} />
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
// (2026-11-16, the owner: "What they can open" should be more intuitive) To do is the whole team's list and Money is all of Defied's books; a login's own My to-do and
// My payments come with their name (lib/own-pages.js), not with these two. So these two read that way in this block only: [label, muted note]. The sidebar tabs keep their names.
const SHOWN = { todo: ["Team to-do", "everyone's"], money: ["All money", "Defied's books"] };
const shownLabel = (k) => (SHOWN[k] ? SHOWN[k][0] : SECTION_OF[k]);
const andList = (words) => (words.length < 3 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
// What a role starts with, in those words, built from its preset (lib/roles.js ROLES), so a preset changed there reads right here: "Intern starts with A&R and Site."
// (Plain loops: the production build inlines a once-used function like this into the component, and an arrow function inside it that reads its argument loses the name.)
function startsWith(role) {
  const preset = ROLES[role], words = [], left = [];
  if (preset.sections.length === SECTIONS.length) return `${preset.label} starts with everything.`;
  for (const k of preset.sections) words.push(role === "comanager" && k === "publishing" ? `${shownLabel(k)} (their own artists)` : shownLabel(k));
  for (const k of ["todo", "money"]) if (!preset.sections.includes(k)) left.push(shownLabel(k));
  let text = `${preset.label} starts with ${andList(words)}.`;
  if (role === "comanager") text += ` My to-do and My payments come with their name.${left.length ? ` ${andList(left)} stay${left.length === 1 ? "s" : ""} with Founders.` : ""}`;
  return text;
}
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
export function UsersAdmin({ db, commit, reloadDb, openId = null, onGo = null }) {
  const founder = db.access?.role === "founder";
  const anyFounder = db.users.some((u) => u.role === "staff" && u.staffRole === "founder");
  const pickOf = (u) => (u.role === "client" ? "client" : ROLES[u.staffRole] ? u.staffRole : anyFounder ? "comanager" : "founder");
  const accessOf = (u) => accessFor({ staffRole: pickOf(u), access: u.access, name: u.name }, { anyFounder: true });
  const artistsOf = (name) => db.clients.filter((c) => sameManager(c.manager, name));
  const managers = useManagers(reloadDb);
  // (2026-11-14) INFO is read once for the page: a Co-manager's (or Founder's) artists and the managers with no account here share it. The
  // artists need Money, and never an account limited to its own artists (the server refuses it: it works on every artist)
  const money = canUse(db, "money"), sheetPicks = money && !db.access?.ownOnly;
  const ps = usePeopleSync(money);
  const sheetRef = useRef(null); // the open form's artists part, when it has one: what its Save sends to the sheet (ArtistsBox registers here)
  const [said, setSaid] = useState(null); // the line after a save that wrote to the sheet or added someone
  const who = (u) => {
    if (u.role === "client") return `Client · ${db.clients.find((c) => c.id === u.clientId)?.name || "no client linked"}`;
    const a = accessOf(u);
    return `${ROLES[a.role].label}${a.ownOnly ? ` · own artists (${artistsOf(u.name).length})` : ""}`;
  };
  // (2026-11-15) the list is by Role unless they chose otherwise (a "Sort by" control above it, and the heads), and the people with no login
  // yet are folded behind their heading: the owner, "hidden by default in users can we have a sort feature to make it easier", "also still
  // need a sort button for the users by role". Both choices are remembered in this browser (a convenience: every read and write is in a try).
  // A form for one of the folded people, or someone just saved with no login yet, opens the group without being asked: that isn't remembered.
  const [sort, setSort] = useState(loadSort);
  const [open, setOpen] = useState(loadOpen);
  const pickSort = (by) => { const next = nextSort(sort, by); setSort(next); saveSort(next); };
  const toggleFold = () => { setOpen(!open); saveOpen(!open); };
  const cols = [
    { key: "email", label: "Email", sort: "name", sortTitle: "Sort by name", render: (u) => <span className="cell-name">{u.email || u.name || "No name"}{u.email && u.name ? <span className="muted"> · {u.name}</span> : null}</span> },
    { key: "role", label: "Role", sort: "access", sortTitle: "Sort by role", render: (u) => <span data-user-access={u.id}>{who(u)}</span> },
    // (2026-11-10) who's set up: their last sign-in and when their password was last set
    { key: "signin", label: "Sign-in", sort: "signin", sortTitle: "Sort by last sign-in", render: (u) => <span className="muted" data-user-signin={u.id}>{u.sheetOnly ? "On the accounting sheet, no account yet" : u.noLogin ? (u.email ? "No password yet" : "No email yet") : u.lastLoginAt ? `Last in ${dayOf(u.lastLoginAt)}` : "Never signed in"}{u.passwordChangedAt ? ` · password set ${dayOf(u.passwordChangedAt)}` : ""}</span> },
  ];
  // (2026-11-15, one place) INFO's managers with no account here are rows of the list, under "No login yet": the Edit of one opens the
  // new-user form with their name and Co-manager filled in and their artists ticked, and Save makes the account (users-list.js)
  const sheetRows = money && ps.data?.info && !ps.data.info.problem ? sheetOnlyManagers(ps.data.info.managers, db.users) : [];
  // (2026-11-14, people link) the people with no login yet (no email or no password) come last, under their own heading;
  // each group in the order chosen, for showing only: saves below use db.users as it is
  const usersShown = orderUsers([...db.users, ...sheetRows], sort.by, sort.dir, pickOf);
  // The form's ONE Save (2026-11-15): the account first (the dashboard's save), then, only when its artists part has something to send, the
  // accounting sheet (the manager's name onto INFO's list if they aren't on it, then the ticks), then, for a person just ADDED, the people
  // link at once (account, INFO, team page, all hidden: components/dash/people-added.jsx). One line says what went through. A sheet part
  // that is refused leaves the account saved: the form stays open, as that account's, with "Saved. Their artists weren't saved: …" and
  // its ticks, so Save again is the retry.
  const save = async (o) => {
    const sheet = sheetRef.current;
    // a cut that can't be written holds the whole Save: nothing is saved half way for a typo
    if (sheet?.block) return `Their artists: ${sheet.block}`;
    // (2026-11-14) no password is a person with no login yet (a set-password link later); a password needs an email
    if ((o.password || "").trim() && !(o.email || "").trim()) return "Add their email first: a password needs an email to sign in with.";
    // (what the list shows until the next load: noLogin isn't saved, the server works it out)
    const typedIn = (o.password || "").trim() && (o.email || "").trim(), noEmail = !(o.email || "").trim();
    const shown = { ...o, noLogin: o.id ? (typedIn ? false : noEmail ? true : !!o.noLogin) : !typedIn };
    const newId = o.id || uid();
    const users = o.id ? db.users.map((u) => u.id === o.id ? shown : u) : [...db.users, { ...shown, id: newId }];
    if (!users.some((u) => u.role === "staff" && (u.email || "").trim() && (!u.noLogin || (u.password || "").trim()))) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    const saved = await saveRow(commit, { ...db, users }, "users", o.id, "user");
    if (!saved || typeof saved === "string") return saved;
    // (2026-11-15) someone saved who has no login yet (just added by hand, or an email taken off): show their group, so they aren't lost in the fold
    if (shown.noLogin) setOpen(true);
    setSaid(null);
    const texts = [];
    let alarm = null, flags = [], added = null;
    if (sheet && sheet.steps.length) {
      const r = await sheet.send();
      if (r.error) return { stay: notSavedLine(r.error, r.texts), id: newId };
      texts.push(...r.texts); alarm = r.alarm;
    }
    if (!o.id) {
      const pick = pickOf(shown), name = (shown.name || "").trim();
      const a = await syncEverywhere({ kind: pick === "client" ? "login" : "staff", id: newId, name: name || shown.email, pick, noLogin: shown.noLogin }, reloadDb);
      added = a.text; flags = a.flags;
    }
    // one line: "Added everywhere: …" alone for a person just added, else "Saved." and what went to the sheet (and that line after it)
    if (added && !texts.length && !alarm) setSaid({ text: added, flags });
    else if (texts.length || alarm || added) setSaid({ text: savedLine(added ? [...texts, added.replace(/^Saved\.\s*/, "")] : texts, alarm), alarm: !!alarm, flags });
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
  return (
    <>
    <Editor title="Users" items={usersShown} columns={cols} groupOf={(u) => (u.noLogin ? NO_LOGIN : null)} openId={openId}
      sort={{ by: sort.by, dir: sort.dir, onSort: pickSort, choices: SORT_CHOICES }}
      fold={{ group: NO_LOGIN, open, onToggle: toggleFold, onShow: () => setOpen(true) }}
      draftOf={(u) => (u.sheetOnly ? { name: u.name, role: "staff", staffRole: "comanager", access: {} } : null)}
      notice={<AddedSaid said={said} onGo={onGo} />}
      blank={{ email: "", password: "", role: "staff", staffRole: "comanager", access: {}, name: "", clientId: null }}
      onSave={save} onDelete={del}
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
            <label className="fld"><span>Which artist is this login for?</span>
              <select value={e.clientId || ""} onChange={(ev) => set({ ...e, clientId: ev.target.value || null })} data-client-pick>
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
          {sheetPicks && (pick === "comanager" || pick === "founder")
            ? <TheirArtists pick={pick} name={(e.name || "").trim()} ps={ps} reg={sheetRef} reloadDb={reloadDb} />
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
                    <span>{shownLabel(k)}{SHOWN[k] && <span className="muted" data-section-note> · {SHOWN[k][1]}</span>}</span>
                  </label>
                );
              })}
              {/* (2026-11-16) a login's own pages come with their name, not with a tick: shown so it is clear they have them (lib/own-pages.js) */}
              <p className="sec-sub" data-own-head>Their own</p>
              {[["mytodo", "My to-do", hasMyTodo(e.name)], ["mypay", "My payments", hasMyPay(e.name)]].map(([k, label, has]) => (
                <label key={k} className="sec-pick locked" data-own-page={k} data-own-has={has ? "yes" : "no"}>
                  <input type="checkbox" checked={has} disabled />
                  <span>{label}{!has && <span className="muted"> (none for {(e.name || "").trim().split(/\s+/)[0] || "them"} yet)</span>}</span>
                </label>
              ))}
              <p className="hint" data-sections-hint>{startsWith(pick)} Tick or untick to change it for this person.</p>
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
