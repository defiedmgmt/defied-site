import { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import { arWrite, bigNum, followChip, pct1, stageOfStatus, statusForStage, wholeMoney, yearOne } from "./ar";
import { AR_STAGES } from "./ar-stages";
import { shortDay } from "./helpers";
import { Area, Field, fmt, useEscape } from "./ui";
import { AskCard, useDirtyGuard } from "../portal/ask";

const BLANK_SONGS = [1, 2, 3, 4, 5].map((slot) => ({ slot, streams: "", writerShare: "" }));
const FIELD_LABEL = { name: "Name", contact: "Contact", status: "Status", lastContact: "Last contacted", notes: "Notes", given: "'Advance given?'" };
const fieldLabel = (f) => FIELD_LABEL[f] || f.replace(/^slot(\d)\.(streams|share)$/, (_, n, k) => `Song ${n} ${k === "streams" ? "streams" : "writer %"}`);
const showVal = (f, v) => (v === "" || v == null ? "blank" : /\.share$/.test(f) && typeof v === "number" ? `${Math.round(v * 1e6) / 1e4}%` : typeof v === "number" ? fmt(v) : String(v));

// The prospect panel (spec 14 S2), and the same form for a new prospect. Name, contact, notes,
// last contacted and the 5 song slots save together in one click (one createProspect, or one
// updateProspect carrying only what was changed, each with the value this panel opened with as
// `expect`); the status and "Advance given?" save at once. The preview totals are computed the way
// the sheet computes them: Net Streams is the sum of each slot's own streams × its own writer %.
// pipeline (A&R › Outreach, r10): the board's panel is a pipeline only: name, contact, stage, notes, last contact and
// follow-up. The 5 song slots (streams + writer share, columns R–AA), the estimates and 'Advance given?' are hidden
// and never sent from it. (2026-11-21: the Advance calculator that used to live in this file moved to Money › EMPIRE deal, components/dash/empire-calc.jsx; A&R's panel is this form alone.)
export function ProspectForm({ prospect, pg, blendedRate, assume, canSave = true, reload, onClose, onChanged, title, picker, extra, pipeline = false }) {
  const isNew = !prospect;
  const [base] = useState(prospect); // what this panel opened with: the `expect` of every Save
  const [name, setName] = useState(prospect?.name || "");
  const [contact, setContact] = useState(prospect?.contact || "");
  const [status, setStatus] = useState(prospect ? prospect.status || "" : "Not Contacted"); // a new one starts in To reach out
  const [notes, setNotes] = useState(prospect?.notes || "");
  const [lastContact, setLastContact] = useState(prospect?.lastContact?.date || "");
  const startSongs = base ? base.songs.map((s) => ({ ...s, streams: s.streams || "", writerShare: s.writerShare || "" })) : BLANK_SONGS;
  const [songs, setSongs] = useState(startSongs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null); // {text, reload?}
  const [ok, setOk] = useState(null);
  const [conflict, setConflict] = useState(null); // {list, send}
  const [events, setEvents] = useState(null);
  const startSongsNow = base ? base.songs : BLANK_SONGS;
  const dirty = isNew
    ? !!(name.trim() || contact.trim() || notes.trim() || songs.some((s) => s.streams !== "" || s.writerShare !== ""))
    : name !== base.name || contact !== (base.contact || "") || notes !== (base.notes || "") || lastContact !== (base.lastContact?.date || "")
      || songs.some((s, i) => String(s.streams) !== String(startSongsNow[i]?.streams || "") || String(s.writerShare) !== String(startSongsNow[i]?.writerShare || ""));
  const guard = useDirtyGuard(dirty, onClose);
  useEscape(guard.tryClose, !busy && !conflict); // as Cancel, which is off while saving
  const loadEvents = () => !isNew && fetch(`/api/ar?events=${encodeURIComponent(prospect.id)}`).then((r) => r.json()).then((d) => setEvents(d.events || [])).catch(() => setEvents([]));
  useEffect(() => { loadEvents(); }, []);
  const setSong = (slot, patch) => setSongs(songs.map((s) => (s.slot === slot ? { ...s, ...patch } : s)));
  const paused = canSave ? undefined : "Saving is paused until the pub sheet can be read again.";

  const grossStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0), 0);
  const netStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0) * ((Number(s.writerShare) || 0) / 100), 0);
  const estRevenue = netStreams * blendedRate;

  // a refusal in plain words: a hand edit meanwhile opens the conflict dialog, a moved row asks for a reload
  const fail = (e, send) => {
    if (e.conflict?.length && send) setConflict({ list: e.conflict, send });
    else setErr({ text: e.message, reload: !!e.reload });
    setBusy(false);
  };
  const after = async (r, keepOpen) => {
    if (keepOpen) { await reload?.(); loadEvents(); setBusy(false); setOk(r?.note || "Saved ✓"); }
    else await onChanged(r);
  };
  const send = async (body, keepOpen = false) => {
    setBusy(true); setErr(null); setOk(null);
    try { await after(await arWrite(body), keepOpen); } catch (e) { fail(e, body); }
  };

  // a slot as the sheet holds it: streams, and the writer % as a 0-1 fraction (blank = cleared)
  const slotOf = (s) => ({ slot: s.slot, streams: s.streams === "" ? null : Number(s.streams), share: s.writerShare === "" ? null : Number(s.writerShare) / 100 });
  const save = async () => {
    if (!name.trim()) return;
    if (isNew) return send({ action: "createProspect", name: name.trim(), contact: contact.trim(), status, notes: notes.trim(), ...(pipeline ? {} : { slots: songs.filter((s) => s.streams !== "" || s.writerShare !== "").map(slotOf) }) });
    // only what changed is sent, each with the value this panel opened with, so a hand edit in the
    // sheet meanwhile (to any field) is never overwritten
    const changes = {}, expect = {};
    if (name.trim() !== base.name) { changes.name = name.trim(); expect.name = base.cells.A; }
    if (contact.trim() !== base.contact.trim()) { changes.contact = contact.trim(); expect.contact = base.cells.B; }
    if (notes.trim() !== (base.notes || "").trim()) { changes.notes = notes.trim(); expect.notes = base.cells.Q; }
    if (lastContact !== (base.lastContact?.date || "")) { changes.lastContact = lastContact; expect.lastContact = base.cells.P; }
    // per cell, so a writer % shown rounded (33.3333) is never written back unless it was changed
    const slots = songs.map((s, i) => {
      const was = startSongs[i], out = { slot: s.slot }, cell = slotOf(s);
      if (String(s.streams) !== String(was.streams)) out.streams = cell.streams;
      if (String(s.writerShare) !== String(was.writerShare)) out.share = cell.share;
      return out;
    }).filter((x) => "streams" in x || "share" in x);
    if (slots.length && !pipeline) { changes.slots = slots; expect.slots = slots.map((s) => base.cells.slots[s.slot - 1]); }
    if (!Object.keys(changes).length) return onClose();
    return send({ action: "updateProspect", prospectId: base.id, changes, expect });
  };
  // [Use mine]: the same save again, now expecting what the sheet holds for the fields that clashed
  const useMine = () => {
    const body = JSON.parse(JSON.stringify(conflict.send));
    for (const c of conflict.list) {
      const m = /^slot(\d)\.(streams|share)$/.exec(c.field);
      if (m) { const e = (body.expect.slots || []).find((x) => Number(x.slot) === Number(m[1])); if (e) e[m[2]] = c.sheet; }
      else if (body.action === "setGiven") body.expect = { given: c.sheet };
      else if (body.action === "setStatus") body.expect = c.sheet;
      else body.expect[c.field] = c.sheet;
    }
    setConflict(null);
    send(body, body.action !== "updateProspect");
  };
  const keepSheets = async () => { setConflict(null); setBusy(true); await onChanged(); };
  const saveStatus = (st) => { if (!st || st === prospect.status) return; setStatus(st); send({ action: "setStatus", prospectId: base.id, status: st, expect: prospect.cells.O ?? "" }, true); };
  const saveGiven = (v) => v && send({ action: "setGiven", prospectId: base.id, given: v === "Yes", expect: { given: prospect.advance?.given ?? "" } }, true);
  const logContact = () => send({ action: "logContact", prospectId: base.id, expect: { lastContact: prospect.cells.P ?? "", status: prospect.cells.O ?? "" } }, true);
  const undo = (id) => send({ action: "undo", eventId: id }, true);
  const [askOff, setAskOff] = useState(false);
  const deleteProspect = async () => {
    setAskOff(false);
    await send({ action: "removeProspect", prospectId: prospect.id, expect: { A: prospect.cells.A } });
  };
  const adv = prospect?.advance;

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && !conflict && guard.tryClose()}>
      <div className={`modal-card${isNew ? "" : " arb-panel"}`}>
        <div className="modal-head">
          <h3>{isNew ? title || "New prospect" : prospect.name}</h3>
          {/* the Board's stage names; the sheet status they stand for is what's saved (statusForStage) */}
          {!isNew && (
            <select className="arb-panel-status" value={stageOfStatus(prospect.status)} onChange={(e) => saveStatus(statusForStage(e.target.value, prospect.status))} disabled={busy || !canSave} title={paused} aria-label="Stage">
              {stageOfStatus(prospect.status) === "other" && <option value="other">{prospect.status}</option>}
              {[...AR_STAGES, { id: "passed", label: "Passed" }].map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
            </select>
          )}
          <button onClick={guard.tryClose} aria-label="Close" disabled={busy}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {picker}
          {err && (
            <p className="hint err-text arb-err" role="alert">
              <span>{err.text}</span>
              {err.reload && <button className="btn ghost sm" onClick={() => onChanged()}>Reload</button>}
            </p>
          )}
          {ok && <p className="hint ok-text" role="status">{ok}</p>}
          {!canSave && !isNew && <p className="hint err-text">Couldn't read the pub sheet just now, so saving is paused. What you see is what it said last time.</p>}

          {!isNew && (
            <div className="arb-actions">
              <button className="btn ghost sm" onClick={logContact} disabled={busy || !canSave} title={paused}><Check size={14} /> Log contact</button>
              {pg?.followUp?.on && (pg.followUp.state ? followChip(pg.followUp)
                : <span className="arb-follow">Follow up: {new Date(`${pg.followUp.on}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>)}
            </div>
          )}

          <div className="arb-panel-grid">
            <div>
              <p className="fld-label mb">Contact</p>
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Field label="Instagram, TikTok or email" value={contact} onChange={(e) => setContact(e.target.value)} />
              {isNew ? (
                <label className="fld"><span>Stage</span>
                  <select value={stageOfStatus(status)} onChange={(e) => setStatus(statusForStage(e.target.value, status))} aria-label="Stage">
                    {[...AR_STAGES, { id: "passed", label: "Passed" }].map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                  </select>
                </label>
              ) : (
                <Field label="Last contacted" type="date" value={lastContact} onChange={(e) => setLastContact(e.target.value)} hint={!prospect.lastContact?.date && prospect.lastContact?.text ? `The sheet says "${prospect.lastContact.text}"` : undefined} />
              )}
              <Area label="Notes (also in the OUTREACH sheet)" value={notes} onChange={(e) => setNotes(e.target.value)} />

              {!pipeline && <>
              <p className="fld-label mb" style={{ marginTop: 18 }}>Songs (up to 5) — Gross Streams and Writer %</p>
              {songs.map((s) => (
                <div key={s.slot} className="ar-song-row">
                  <span className="ar-song-num">{s.slot}</span>
                  <input type="number" placeholder="Gross streams" value={s.streams} onChange={(e) => setSong(s.slot, { streams: e.target.value })} aria-label={`Song ${s.slot} gross streams`} />
                  <input type="number" placeholder="Writer %" value={s.writerShare} onChange={(e) => setSong(s.slot, { writerShare: e.target.value })} aria-label={`Song ${s.slot} writer %`} />
                </div>
              ))}
              <p className="hint">The OUTREACH tab has 5 song slots; those feed the sheet's estimates.</p>
              </>}
            </div>

            <div>
              {!pipeline && <>
              <p className="fld-label mb">What they could earn us</p>
              <div className="cat-summary" style={{ marginBottom: 10 }}>
                {/* the sheet's total first and full width; short numbers so nothing is cut off */}
                <div className="cat-summary-grid ar-panel-tiles">
                  {!isNew && <div className="cat-stat ar-tile-wide"><span className="cat-stat-label">Total est. value</span><span className="cat-stat-val">≈ {wholeMoney(prospect.money.totalEstValue)}</span></div>}
                  <div className="cat-stat"><span className="cat-stat-label">Gross streams</span><span className="cat-stat-val">{bigNum(grossStreams)}</span></div>
                  <div className="cat-stat"><span className="cat-stat-label">Net streams (their share)</span><span className="cat-stat-val">{bigNum(netStreams)}</span></div>
                  {/* the writer's own all-time earnings, not ours: our cut (the sheet's admin fee) gets its own readable line under it */}
                  <div className="cat-stat ar-tile-wide"><span className="cat-stat-label">Their est. publishing earnings (all-time)</span><span className="cat-stat-val">{wholeMoney(estRevenue)}</span>{assume?.adminFeeRate != null && <span className="ar-tile-cut" data-our-cut>Our {Math.round(assume.adminFeeRate * 100)}% ≈ {wholeMoney(estRevenue * assume.adminFeeRate)}</span>}</div>
                </div>
              </div>
              <p className="hint arb-money-tip">Estimates, not payouts: all-time streams × their writer share × ${blendedRate} a stream (the rate in ASSUMPTIONS), from the OUTREACH tab's own formulas. Year 1 = {yearOne(assume) ? `${yearOne(assume).share} of their all-time earnings (${yearOne(assume).how})` : "a set share of their all-time earnings"}, then {assume?.decayRate != null ? pct1(assume.decayRate) : "a set amount"} less each year; we keep {assume?.adminFeeRate != null ? `${Math.round(assume.adminFeeRate * 100)}%` : "our cut"}. Real income depends on platform, country and deal.</p>
              {!isNew && (
                <label className="fld"><span>Advance given?</span>
                  <select value={adv?.given || ""} onChange={(e) => saveGiven(e.target.value)} disabled={busy || !canSave || !adv?.editable} title={adv?.editable ? paused : adv?.why || undefined}>
                    {!adv?.given && <option value="">Not answered</option>}
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                  {adv && !adv.editable && adv.why && <span className="hint">{adv.why}</span>}
                </label>
              )}

              </>}
              {!isNew && extra}
              {!isNew && (
                <>
                  <p className="fld-label mb" style={{ marginTop: 18 }}>History</p>
                  {!events && <p className="muted">Loading…</p>}
                  {events && !events.length && <p className="arb-empty">Nothing yet.</p>}
                  {events && events.length > 0 && (
                    <ul className="arb-history">
                      {events.map((e) => (
                        <li key={e.id}>
                          <span><span className="arb-when">{shortDay(e.at)}</span> · {e.text}{e.status === "undone" ? " (undone)" : e.status === "failed" ? " (didn't save)" : ""}</span>
                          {e.undoable && <button className="btn ghost sm" onClick={() => undo(e.id)} disabled={busy || !canSave} title={paused}>Undo</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {guard.bar}
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text arb-remove" onClick={() => setAskOff(true)} disabled={busy || !canSave} title={paused}>Remove from board</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || !name.trim() || !canSave} title={paused}>{busy ? "Saving…" : isNew ? "Save" : "Save changes"}</button>
        </div>
      </div>
      {askOff && (
        <AskCard title={`Take ${prospect.name} off the board?`} goLabel="Remove from board" busyLabel="Removing…" go={deleteProspect} onClose={() => setAskOff(false)}>
          <p>Their row in the OUTREACH tab is cleared, including 'Advance given?'. Their songs, notes and history stay here, and 'Put back' returns them to the sheet.</p>
        </AskCard>
      )}
      {conflict && (
        <div className="modal arb-conflict" onClick={(e) => e.stopPropagation()}>
          <div className="modal-card">
            <div className="modal-head"><h3>Someone changed this in the sheet</h3></div>
            <div className="modal-body">
              {conflict.list.map((c) => (
                <p key={c.field} className="mb">While you were editing, the OUTREACH tab changed. {fieldLabel(c.field)} now says "{showVal(c.field, c.sheet)}". Yours says "{showVal(c.field, c.yours)}".</p>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={keepSheets}>Keep the sheet version</button>
              <button className="btn sm" onClick={useMine}>Keep my changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
