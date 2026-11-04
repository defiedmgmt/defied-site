import { useState, useEffect, useMemo } from "react";
import { X, Check, ExternalLink } from "lucide-react";
import { swrJson } from "../ui/fetch-cache";
import { AR_STAGES, ArDataError, arWrite, bigNum, followChip, pct1, stageOfStatus, statusForStage, useArData, wholeMoney, yearOne } from "./ar";
import { shortDay } from "./helpers";
import { Area, Field, fmt, money, useEscape } from "./ui";
import { AskCard, useDirtyGuard } from "../portal/ClientPortal";
import { ExtLink } from "../shared/ui";
import { findByName } from "../site/data";

const BLANK_SONGS = [1, 2, 3, 4, 5].map((slot) => ({ slot, streams: "", writerShare: "" }));
const FIELD_LABEL = { name: "Name", contact: "Contact", status: "Status", lastContact: "Last contacted", notes: "Notes", given: "'Advance given?'" };
const fieldLabel = (f) => FIELD_LABEL[f] || f.replace(/^slot(\d)\.(streams|share)$/, (_, n, k) => `Song ${n} ${k === "streams" ? "streams" : "writer %"}`);
const showVal = (f, v) => (v === "" || v == null ? "blank" : /\.share$/.test(f) && typeof v === "number" ? `${Math.round(v * 1e6) / 1e4}%` : typeof v === "number" ? fmt(v) : String(v));

// The prospect panel (spec 14 S2), and the same form for a new prospect. Name, contact, notes,
// last contacted and the 5 song slots save together in one click (one createProspect, or one
// updateProspect carrying only what was changed, each with the value this panel opened with as
// `expect`); the status and "Advance given?" save at once. The preview totals are computed the way
// the sheet computes them: Net Streams is the sum of each slot's own streams × its own writer %.
export function ProspectForm({ prospect, pg, blendedRate, assume, canSave = true, reload, onClose, onChanged, title, picker, extra }) {
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
    if (isNew) return send({ action: "createProspect", name: name.trim(), contact: contact.trim(), status, notes: notes.trim(), slots: songs.filter((s) => s.streams !== "" || s.writerShare !== "").map(slotOf) });
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
    if (slots.length) { changes.slots = slots; expect.slots = slots.map((s) => base.cells.slots[s.slot - 1]); }
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

              <p className="fld-label mb" style={{ marginTop: 18 }}>Songs (up to 5) — Gross Streams and Writer %</p>
              {songs.map((s) => (
                <div key={s.slot} className="ar-song-row">
                  <span className="ar-song-num">{s.slot}</span>
                  <input type="number" placeholder="Gross streams" value={s.streams} onChange={(e) => setSong(s.slot, { streams: e.target.value })} aria-label={`Song ${s.slot} gross streams`} />
                  <input type="number" placeholder="Writer %" value={s.writerShare} onChange={(e) => setSong(s.slot, { writerShare: e.target.value })} aria-label={`Song ${s.slot} writer %`} />
                </div>
              ))}
              <p className="hint">The OUTREACH tab has 5 song slots; those feed the sheet's estimates.</p>
            </div>

            <div>
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

// Mirrors the ADVANCE CALCULATOR tab's own row formulas exactly (verified
// cell-by-cell against a real prospect's computed values before shipping).
// netStreams is the only real input; everything else is an assumption
// pulled live from the sheet, or a target staff can tune per-run.
function calcAdvance({ netStreams, blendedRate, runRate, decay, adminFeeRate, recoupMonths }) {
  const royYr1 = netStreams * blendedRate * runRate * (1 - decay);
  const royYr2 = royYr1 * (1 - decay);
  const royYr3 = royYr2 * (1 - decay);
  const roy3yr = royYr1 + royYr2 + royYr3;
  const adminYr1 = royYr1 * adminFeeRate;
  const adminYr2 = royYr2 * adminFeeRate;
  const adminYr3 = royYr3 * adminFeeRate;
  const admin3yr = roy3yr * adminFeeRate;
  const advance = adminYr1 * (recoupMonths / 12);

  let monthsToRecoup = null;
  if (adminYr1 > 0) {
    if (advance <= adminYr1) monthsToRecoup = (advance / adminYr1) * 12;
    else if (advance <= adminYr1 + adminYr2) monthsToRecoup = (1 + (advance - adminYr1) / adminYr2) * 12;
    else if (advance <= adminYr1 + adminYr2 + adminYr3) monthsToRecoup = (2 + (advance - adminYr1 - adminYr2) / adminYr3) * 12;
    else monthsToRecoup = (3 + (advance - adminYr1 - adminYr2 - adminYr3) / adminYr3) * 12;
  }
  const coverage = advance > 0 ? admin3yr / advance : null;
  const verdict = monthsToRecoup == null ? null
    : monthsToRecoup <= 18 ? "Safe"
    : monthsToRecoup <= 30 ? "Workable"
    : monthsToRecoup <= 36 ? "Tight"
    : "Too high — lower target";

  return { royYr1, royYr2, royYr3, roy3yr, adminYr1, adminYr2, adminYr3, admin3yr, advance, monthsToRecoup, coverage, verdict };
}

// A blank scenario to start from — no prospect/client picked, no streams
// typed. Matches the same field shape Outreach's own single-song entry
// uses (Gross Streams + Writer %), not a raw Net Streams number,
// specifically so a from-scratch scenario can be saved as a real prospect
// later: Net Streams alone can't be decomposed back into streams+split,
// but Gross Streams + Writer % round-trips into Outreach's Song 1 slot
// exactly.
const BLANK_SCENARIO = { kind: "new", key: "", name: "", contact: "", grossStreams: "", writerShare: "" };

function AdvanceCalcPanel({ data, reload, pick = null }) {
  const { assumptions, recoupTargetMonths, budget, prospects, signedClients } = data;
  const links = data.sheet?.links || {};
  // the Watchlist's "Work out an advance" opens it with that prospect picked
  const [scenario, setScenario] = useState(() => (pick && prospects.some((p) => p.id === pick) ? { ...BLANK_SCENARIO, kind: "outreach", key: pick, name: prospects.find((p) => p.id === pick)?.name || "" } : BLANK_SCENARIO));
  const [recoupMonths, setRecoupMonths] = useState(recoupTargetMonths);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const selectedProspect = scenario.kind === "outreach" ? prospects.find((p) => p.id && p.id === scenario.key) : null;
  const selectedClient = scenario.kind === "client" ? signedClients.find((c) => c.id === scenario.key) : null;
  // an existing prospect/client's Net Streams comes straight from the sheet
  // or catalog's own sum across everything they have (could be more than
  // one song) — a from-scratch scenario only ever has the one Gross
  // Streams/Writer % pair being typed, computed the same way the sheet
  // computes each song slot.
  const netStreams = selectedProspect ? selectedProspect.money.netStreams
    : selectedClient ? selectedClient.netStreams
    : (Number(scenario.grossStreams) || 0) * ((Number(scenario.writerShare) || 0) / 100);

  const selectScenario = (value) => {
    setSaved(false);
    if (!value) { setScenario(BLANK_SCENARIO); return; }
    const [kind, key] = value.split(":");
    if (kind === "outreach") {
      const p = prospects.find((x) => x.id === key);
      setScenario({ kind, key, name: p?.name || "", contact: p?.contact || "", grossStreams: "", writerShare: "" });
    } else if (kind === "client") {
      const c = signedClients.find((x) => x.id === key);
      setScenario({ kind, key, name: c?.name || "", contact: "", grossStreams: "", writerShare: "" });
    }
  };
  const setField = (patch) => { setSaved(false); setScenario({ ...scenario, ...patch }); };

  const result = useMemo(() => calcAdvance({
    netStreams,
    blendedRate: assumptions.blendedRate,
    runRate: assumptions.runRate,
    decay: assumptions.decayRate,
    adminFeeRate: assumptions.adminFeeRate,
    recoupMonths: Number(recoupMonths) || 12,
  }), [netStreams, recoupMonths, assumptions]);
  const estRevenue = netStreams * assumptions.blendedRate;

  const saveToOutreach = async () => {
    if (!scenario.name.trim() || !netStreams) return;
    setBusy(true); setErr(null);
    try {
      const { prospect } = await arWrite({
        action: "createProspect", name: scenario.name.trim(), contact: scenario.contact.trim(),
        slots: [{ slot: 1, streams: Number(scenario.grossStreams) || 0, share: (Number(scenario.writerShare) || 0) / 100 }],
      });
      await reload();
      setScenario({ kind: "outreach", key: prospect.id, name: scenario.name, contact: scenario.contact, grossStreams: "", writerShare: "" });
      setSaved(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setGiven = async (given) => {
    if (!selectedProspect) return;
    setBusy(true); setErr(null);
    try {
      await arWrite({ action: "setGiven", prospectId: selectedProspect.id, given, expect: { given: selectedProspect.advance.given } });
      await reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="admin-head">
        <h2>Advance calculator</h2>
        {links.advanceCalculator && (
          <ExtLink href={links.advanceCalculator} className="btn ghost sm"><ExternalLink size={14} /> Open in sheet</ExtLink>
        )}
      </div>
      <p className="muted mb">Works out an advance the same way the sheet's ADVANCE CALCULATOR tab does.</p>
      {/* the dollars below use the pub sheet's rate (ASSUMPTIONS!B7), read live: say which */}
      <p className="hint adv-rate" title="The rate is ASSUMPTIONS!B7 on the pub sheet">{assumptions.blendedRate != null ? `At $${+Number(assumptions.blendedRate).toFixed(6)} a stream (your pub sheet's rate).` : "At your pub sheet's rate a stream."}</p>

      <div className="cat-summary" style={{ marginBottom: 20, maxWidth: 560 }}>
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Starting Budget</span><span className="cat-stat-val">{money(budget.starting)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Committed (Given)</span><span className="cat-stat-val">{money(budget.committed)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Remaining</span><span className="cat-stat-val">{money(budget.remaining)}</span></div>
        </div>
      </div>

      {/* wide screens: the result sits beside the form, so it shows in the first screen as you type */}
      <div className="adv-cols">
      <div className="form-card" style={{ maxWidth: 560 }}>
        <label className="fld"><span>Prospect or signed client</span>
          <select value={scenario.kind === "new" ? "" : `${scenario.kind}:${scenario.key}`} onChange={(e) => selectScenario(e.target.value)}>
            <option value="">— someone new (type their streams) —</option>
            {signedClients.length > 0 && (
              <optgroup label="Our clients">
                {signedClients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name} ({fmt(c.netStreams)} net streams{c.netFromSheet === false ? ", estimate" : ", from the pub sheet"})</option>)}
              </optgroup>
            )}
            {prospects.length > 0 && (
              <optgroup label="Prospects (A&R)">
                {prospects.filter((p) => p.id).map((p) => <option key={p.id} value={`outreach:${p.id}`}>{p.name} ({fmt(Math.round(p.money.netStreams))} net streams)</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {selectedProspect || selectedClient ? (
          <p className="hint">
            Net Streams ({fmt(Math.round(netStreams))}) comes from {selectedClient ? (selectedClient.netFromSheet === false ? `an estimate from ${scenario.name}'s catalog (no sheet tab read yet)` : `${scenario.name}'s tab of the pub sheet`) : `${scenario.name}'s songs in Outreach`} —
            edit {selectedClient ? "their songs on Overview & clients" : "those on the A&R tab"} to change this.
          </p>
        ) : (
          <>
            <Field label="Prospect / Producer" value={scenario.name} onChange={(e) => setField({ name: e.target.value })} placeholder="Who are you evaluating?" />
            <Field label="Contact or Handle" value={scenario.contact} onChange={(e) => setField({ contact: e.target.value })} />
            <Field label="Gross Streams" type="number" value={scenario.grossStreams} onChange={(e) => setField({ grossStreams: e.target.value })} />
            <Field label="Writer %" type="number" value={scenario.writerShare} onChange={(e) => setField({ writerShare: e.target.value })} />
            {netStreams > 0 && <p className="hint">Net streams: {fmt(Math.round(netStreams))} · Their earnings so far: {money(estRevenue)}</p>}
          </>
        )}
        <Field
          label="Recoup target (months)" type="number" value={recoupMonths}
          onChange={(e) => setRecoupMonths(e.target.value)}
          hint="The advance is this many months of our fee in year 1. 12 to 18 is usual, 24 to 36 is aggressive."
        />
        <p className="hint">Paid back out of our fee, not their share.</p>
        {err && <p className="hint err-text">{err}</p>}
        {/* saving flips scenario.kind to "outreach", which swaps in the
            read-only reference block above on the very next render — the
            confirmation has to live outside that block or it vanishes
            before anyone sees it */}
        {saved && <p className="hint ok-text">Added as a prospect ✓ — {scenario.name} is now on the A&amp;R board, shown below with its real numbers.</p>}
        {scenario.kind === "new" && (
          <button className="btn sm" onClick={saveToOutreach} disabled={busy || !scenario.name.trim() || !netStreams}>
            {busy ? "Saving…" : "Add as prospect"}
          </button>
        )}
        {selectedProspect && (
          <div className="ar-given-row">
            {/* a blank cell is "Not answered" (as on the panel), never a lit No; said on the label, before
                the buttons, so it never reads as a third choice */}
            <span className="fld-label">Advance given?{!selectedProspect.advance.given && <span className="ar-given-none"> · Not answered yet</span>}</span>
            <button className={selectedProspect.advance.given === "Yes" ? "btn sm" : "btn ghost sm"} aria-pressed={selectedProspect.advance.given === "Yes"} onClick={() => setGiven(true)} disabled={busy || !selectedProspect.advance.editable}>Yes</button>
            <button className={selectedProspect.advance.given === "No" ? "btn sm" : "btn ghost sm"} aria-pressed={selectedProspect.advance.given === "No"} onClick={() => setGiven(false)} disabled={busy || !selectedProspect.advance.editable}>No</button>
          </div>
        )}
        {selectedProspect && !selectedProspect.advance.editable && selectedProspect.advance.why && <p className="hint">{selectedProspect.advance.why}</p>}
        {selectedClient && (
          <p className="hint">Signed clients aren't tracked in the Given/budget total above — this is for planning an additional advance only.</p>
        )}
      </div>

      <div className="adv-out">
      {/* nothing to work out yet: one line says what to do, instead of rows of $0.00; streams typed with no
          writer % asks for the % */}
      {!selectedProspect && !selectedClient && !netStreams ? <p className="adv-empty">{Number(scenario.grossStreams) > 0 && !(Number(scenario.writerShare) > 0) ? "Add their writer share (%) to see an advance." : "Pick a client or prospect, or type streams, to see an advance."}</p> : <>
      <div className="cat-summary">
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Recommended Advance</span><span className="cat-stat-val">{money(result.advance)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Months to Recoup</span><span className="cat-stat-val">{result.monthsToRecoup != null ? `${result.monthsToRecoup.toFixed(1)} mo` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Coverage</span><span className="cat-stat-val">{result.coverage != null ? `${result.coverage.toFixed(1)}x` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Verdict</span><span className="cat-stat-val" data-tone={!result.verdict ? undefined : result.verdict === "Safe" ? "pos" : result.verdict === "Tight" ? "warn" : result.verdict.startsWith("Too high") ? "neg" : "neutral"}>{result.verdict || "—"}</span></div>
        </div>
      </div>

      <div className="split-list" style={{ marginTop: 16 }}>
        <div className="split-list-row"><span className="split-name">Their earnings yr 1</span><span className="split-pct">{money(result.royYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Their earnings yr 2</span><span className="split-pct">{money(result.royYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Their earnings yr 3</span><span className="split-pct">{money(result.royYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Their earnings next 3 yrs</span><span>{money(result.roy3yr)}</span></div>
      </div>
      <div className="split-list" style={{ marginTop: 12 }}>
        <div className="split-list-row"><span className="split-name">Our fee yr 1</span><span className="split-pct">{money(result.adminYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Our fee yr 2</span><span className="split-pct">{money(result.adminYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Our fee yr 3</span><span className="split-pct">{money(result.adminYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Our fee next 3 yrs</span><span>{money(result.admin3yr)}</span></div>
      </div>
      </>}
      </div>
      </div>
    </div>
  );
}

// Publishing › Advance calculator: the sheet read happens only once this sub-tab opens
export function AdvanceTab({ pick = null, db = null }) {
  const { data, err, load, retry } = useArData();
  // the calculator's levers and budget come from the sheet itself: nothing to work out without it
  const down = data && data.sheet?.ok === false;
  return (
    <>
      {err && <ArDataError err={err} retry={retry} />}
      {down && <ArDataError err="Couldn't read the pub sheet just now, so the Advance calculator can't work out its numbers." retry={retry} />}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && !down && <div className="pub-sec"><AdvanceCalcPanel data={data} reload={load} pick={pick} /></div>}
      <RosterForecast db={db} />
    </>
  );
}

// Publishing › Advance calculator: the pub sheet's own 3-year forecast of our fee (MASTER), for the roster and
// by writer (r7: it moved here from Publishing's Overview). The sheet's Year 1 is the fee so far × B9 × (1 − B8),
// then B8 less each year: a rough guess, said so.
function RosterForecast({ db }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [byWriter, setByWriter] = useState(false);
  useEffect(() => {
    let alive = true;
    swrJson("/api/sheets-master", (x) => alive && setD(x), { keep: (x) => !!x?.totals }).then((x) => { if (alive && !x?.totals) setFailed(true); }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return <p className="hint">Couldn't read the roster's forecast from the pub sheet just now.</p>;
  if (!d) return null;
  const y = yearOne(d);
  // MASTER's Writer label can be stale ("Stackie", "WRITER 13"): the client its formulas read, as on Overview
  const writerOf = (r) => { const cs = db?.clients || []; const c = findByName([...cs.filter((x) => x.sheetTabName), ...cs.filter((x) => !x.sheetTabName)], r.sheetTab || r.writer, (x) => x.sheetTabName || x.name); return c ? c.name : r.writer; };
  return (
    <div className="pub-sec adv-forecast" data-forecast>
      <h3 className="lm-h3">Our fee, next 3 years</h3>
      <p className="hint">The pub sheet's rough guess{y ? `: ${y.share} of the fee so far in year 1, then ${y.decay} less a year` : ""}.</p>
      <div className="cat-summary"><div className="cat-summary-grid">
        <div className="cat-stat" data-stat="next3"><span className="cat-stat-label">Next 3 years</span><span className="cat-stat-val">{money(d.totals.threeYearForecast)}</span></div>
        <div className="cat-stat" data-stat="inAll"><span className="cat-stat-label">So far + 3 years</span><span className="cat-stat-val">{money(d.totals.totalEstAdminFee)}</span></div>
      </div></div>
      <button className="btn ghost sm" data-forecast-writers aria-pressed={byWriter} onClick={() => setByWriter((v) => !v)}>{byWriter ? "Hide writers" : "By writer"}</button>
      {byWriter && (
        <div className="master-table-wrap m-cards-wrap">
          <table className="master-table m-cards">
            <thead><tr>{["Writer", "Year 1", "Year 2", "Year 3", "Next 3 yrs", "In all"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{(d.rows || []).map((r) => <tr key={r.writer}><td>{writerOf(r)}</td><td data-label="Year 1">{money(r.year1)}</td><td data-label="Year 2">{money(r.year2)}</td><td data-label="Year 3">{money(r.year3)}</td><td data-label="Next 3 yrs">{money(r.forecastTotal)}</td><td data-label="In all">{money(r.totalEstAdminFee)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
