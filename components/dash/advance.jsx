import { useState, useEffect, useMemo } from "react";
import { X, Check, ExternalLink } from "lucide-react";
import { swrJson } from "../ui/fetch-cache";
import { ArDataError, arWrite, bigNum, followChip, pct1, stageOfStatus, statusForStage, useArData, wholeMoney, yearOne } from "./ar";
import { AR_STAGES } from "./ar-stages";
import { shortDay } from "./helpers";
import { Area, Field, fmt, money, useEscape } from "./ui";
import { AskCard, useDirtyGuard } from "../portal/ask";
import { ExtLink } from "../shared/ui";
import { findByName } from "../site/data";
import { advanceModel, verdictFor, VERDICTS } from "../../lib/advance-model";

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
// and never sent from it; Publishing › Advance calculator is unchanged.
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

// The Advance calculator's screen (2026-11-20). Its math is lib/advance-model.js (pure, tested): what our fee pays back in the months picked, with the
// slowdown. It starts from TODAY'S PACE, the streams a year the person earns now: a signed client's comes from real daily readings (`pace` from
// /api/ar-data, lib/advance-pace.js), anyone else's from the sheet's rule, lifetime streams × the run-rate (ASSUMPTIONS!B9). The sheet's own
// ADVANCE CALCULATOR tab still uses that rule for everyone, so its numbers differ (the page says so).
// A client's pace counts as measured when at least this share of it comes from songs with daily readings; below that the page uses the rule and says so.
const REAL_PACE_MIN = 0.5;
// A measured pace gets a warning when this share of it comes from songs out under 3 months (they usually fall faster than the assumed slowdown).
const NEW_SONGS_WARN = 0.25;

// Today's pace for who's picked (streams a year, their share) and where it comes from, in words. client: a signedClients row (with `pace`) or null
function paceOf({ client, netStreams, runRate, decay }) {
  const p = client?.pace || null;
  const rule = pct1(runRate);
  if (p && p.realShare >= REAL_PACE_MIN) {
    const rest = p.songs - p.tracked;
    const dates = p.from && p.to ? `, ${shortDay(p.from)} to ${shortDay(p.to)}` : "";
    const other = p.rulePerYear > 0 ? ` ${rest === 1 ? "The other song uses" : `The other ${rest} use`} the sheet's rule (${rule} of lifetime a year).` : "";
    return {
      real: true, perYear: p.perYear,
      source: `Real streams: Spotify's daily counts for ${p.tracked} of ${p.songs} ${p.songs === 1 ? "song" : "songs"}${dates}, scaled to all platforms by each song's lifetime total.${other}`,
      warning: p.newShare >= NEW_SONGS_WARN ? `${Math.round(p.newShare * 100)}% of this pace is from songs out under 3 months. New songs usually drop faster than ${pct1(decay)} a year, so treat this as the high end.` : null,
    };
  }
  return {
    real: false, perYear: netStreams * runRate, warning: null,
    source: p && p.tracked > 0
      ? `Estimate: Spotify's daily counts cover only ${pct1(p.realShare)} of their pace (${p.tracked} of ${p.songs} songs), so this uses the sheet's rule: lifetime streams × ${rule} a year.`
      : `Estimate: no daily tracking for their songs, so this uses the sheet's rule: lifetime streams × ${rule} a year.`,
  };
}

// verdict pills: Safe, Workable, Tight, Too high (the sentence "Too high — lower it" is the model's)
// The verdict is judged on the months as the page shows them (to a tenth), so an advance typed back from a dollar figure rounded to the cent, or the last digit of
// a float, never flips it at 18, 30 or 36: the model's own 36-month advance checked is 36.00000000000001 months, and that must say Tight, not "Too high".
const verdictShown = (m) => verdictFor(Number.isFinite(m) ? Math.round(m * 10) / 10 : m);
const verdictTone = (v) => (!v ? undefined : v === "Safe" ? "pos" : v === "Tight" ? "warn" : v.startsWith("Too high") ? "neg" : "neutral");
const VerdictPill = ({ verdict }) => (verdict ? <span className="adv-pill" data-tone={verdictTone(verdict)} data-verdict={verdict}>{verdict.startsWith("Too high") ? "Too high" : verdict}</span> : null);
// months to one decimal, no trailing .0: "36 months", "31.2 months", "1 month"
const monthsText = (m) => `${Math.round(m * 10) / 10} ${Math.round(m * 10) / 10 === 1 ? "month" : "months"}`;
// the months typed: blank (or nothing sensible) is 12, otherwise 1 to 120
const clampMonths = (v) => { const n = Number(v); return String(v ?? "").trim() === "" || !Number.isFinite(n) ? 12 : Math.min(Math.max(n, 1), 120); };
// an advance typed to check, with or without the $ and commas: a number above 0, or null
const amountOf = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
// the sentence under "Check an amount" (model.check: advanceModel's answer for it)
function checkSentence(model) {
  const c = model.check;
  if (!c) return null;
  const covers = c.coverage != null ? ` Our fee over 3 years covers it ${c.coverage.toFixed(1)}×.` : "";
  if (c.months == null) return { tone: "neutral", text: "There's no fee at this pace, so there's nothing to pay it back from." };
  if (c.months === Infinity) return { tone: "neg", text: `Our fee would never pay this back at this pace${model.ceiling != null ? `; the most it could ever repay is ${money(model.ceiling)}` : ""}.${covers}` };
  const verdict = verdictShown(c.months);
  return { tone: verdictTone(verdict), text: `Pays back in ${monthsText(c.months)} (${verdict}).${covers}` };
}
// "Verdict: Safe ≤ 18 months to pay back, Workable ≤ 30, Tight ≤ 36, Too high beyond." from the model's own limits
const verdictRule = () => `Verdict: ${[`${VERDICTS[0][1]} ≤ ${VERDICTS[0][0]} months to pay back`, ...VERDICTS.slice(1).map(([max, word]) => `${word} ≤ ${max}`), "Too high beyond"].join(", ")}.`;

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
  const [checkAmount, setCheckAmount] = useState(""); // an advance typed to check: how long our fee takes to pay it back

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
  const setField = (patch) => { setScenario({ ...scenario, ...patch }); };

  // the sheet's levers (ASSUMPTIONS), today's pace for who's picked, and the model's answer
  const runRate = Number(assumptions.runRate) || 0, decay = Number(assumptions.decayRate) || 0, fee = Number(assumptions.adminFeeRate) || 0;
  const pace = paceOf({ client: selectedClient, netStreams, runRate, decay });
  const R = clampMonths(recoupMonths);
  const amount = amountOf(checkAmount);
  const model = useMemo(() => advanceModel({
    annualNetStreams: pace.perYear,
    blendedRate: assumptions.blendedRate,
    decay: assumptions.decayRate,
    feeRate: assumptions.adminFeeRate,
    recoupMonths: R,
    amount,
  }), [pace.perYear, R, amount, assumptions]);
  const estRevenue = netStreams * assumptions.blendedRate;
  const empty = !selectedProspect && !selectedClient && !netStreams;
  const checked = checkSentence(model);
  const rateText = assumptions.blendedRate != null ? `$${+Number(assumptions.blendedRate).toFixed(6)}` : "the pub sheet's rate";

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
      <p className="muted mb">How big an advance our fee can pay back, worked out from the streams they're earning today. It's paid back out of our fee, not their share. The sheet's own ADVANCE CALCULATOR tab uses a simpler rule, so its numbers differ.</p>
      {/* the dollars below use the pub sheet's rate (ASSUMPTIONS!B7), read live: say which */}
      <p className="hint adv-rate" title="The rate is ASSUMPTIONS!B7 on the pub sheet">{assumptions.blendedRate != null ? `At $${+Number(assumptions.blendedRate).toFixed(6)} a stream (your pub sheet's rate).` : "At your pub sheet's rate a stream."}</p>

      <div className="cat-summary" style={{ marginBottom: 20, maxWidth: 560 }}>
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Starting Budget</span><span className="cat-stat-val">{money(budget.starting)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Committed (Given)</span><span className="cat-stat-val">{money(budget.committed)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Remaining</span><span className="cat-stat-val">{money(budget.remaining)}</span></div>
        </div>
      </div>

      {/* wide screens: the answer sits beside the form, so it shows in the first screen as you type; the year by year numbers and
          "How we got these numbers" run full width under both */}
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
            Net Streams ({fmt(Math.round(netStreams))}) comes from {selectedClient ? (selectedClient.netFromSheet === false ? `an estimate from ${scenario.name}'s catalog (no sheet tab read yet)` : `${scenario.name}'s tab of the pub sheet`) : `${scenario.name}'s rows on the pub sheet's OUTREACH tab`} —
            edit {selectedClient ? "their songs on Overview & clients" : "them there"} to change this.
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
        {/* where today's pace comes from: real daily streams for a signed client with enough of them, otherwise the sheet's rule */}
        {!empty && <p className="hint adv-source" data-adv-source={pace.real ? "real" : "estimate"}>{pace.source}</p>}
        {!empty && pace.warning && <p className="hint adv-warn" data-tone="warn" data-adv-warn role="note">{pace.warning}</p>}
        <Field
          label="Pay it back in (months)" type="number" min={1} max={120} value={recoupMonths}
          onChange={(e) => setRecoupMonths(e.target.value)}
          hint={`How fast our fee should pay it back. Safe is ${VERDICTS[0][0]} months or less; past ${VERDICTS[VERDICTS.length - 1][0]} is too high.`}
        />
        {String(recoupMonths ?? "").trim() !== "" && Number(recoupMonths) !== R && <p className="hint" data-adv-clamp>Using {monthsText(R)} (it can be 1 to 120 months).</p>}
        {err && <p className="hint err-text">{err}</p>}
        {/* r11 launch: no "Save to the sheet's OUTREACH tab" for a from-scratch scenario; Outreach is gone (owner) */}
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
      {empty ? <p className="adv-empty">{Number(scenario.grossStreams) > 0 && !(Number(scenario.writerShare) > 0) ? "Add their writer share (%) to see an advance." : "Pick a client or prospect, or type streams, to see an advance."}</p> : <>
      <div className="cat-summary" data-adv-tiles>
        <div className="cat-summary-grid">
          <div className="cat-stat" data-stat="advance"><span className="cat-stat-label">{`Advance that pays back in ${monthsText(R)}`}</span><span className="cat-stat-val">{money(model.recommended)}</span>{model.recommended > 0 && <VerdictPill verdict={verdictShown(R)} />}</div>
          <div className="cat-stat" data-stat="theirs"><span className="cat-stat-label">Their earnings, next 12 months</span><span className="cat-stat-val">{money(model.their[0])}</span><span className="adv-stat-sub">{decay > 0 ? `slowing ${pct1(decay)} a year` : "no slowdown"}</span></div>
          <div className="cat-stat" data-stat="ours"><span className="cat-stat-label">Our fee, next 12 months</span><span className="cat-stat-val">{money(model.ours[0])}</span><span className="adv-stat-sub">{`our ${pct1(fee)} of theirs`}</span></div>
          <div className="cat-stat" data-stat="pace"><span className="cat-stat-label">Today's pace</span><span className="cat-stat-val">{bigNum(model.pace)}</span><span className="adv-stat-sub">{pace.real ? "streams a year, from daily counts" : "streams a year, an estimate"}</span></div>
        </div>
      </div>

      {model.feeNow > 0 ? <>
        <div className="adv-block" data-adv-ladder>
          <h3 className="adv-h">Advance for each payback time</h3>
          <table className="adv-ladder">
            <thead><tr><th scope="col">Pays back in</th><th scope="col">Advance</th><th scope="col">Verdict</th></tr></thead>
            <tbody>
              {model.ladder.map((r) => (
                <tr key={r.months} data-ladder-months={r.months} data-chosen={r.months === R ? "" : undefined} aria-current={r.months === R ? "true" : undefined}>
                  <td>{monthsText(r.months)}</td><td>{money(r.advance)}</td><td><VerdictPill verdict={r.verdict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="adv-block" data-adv-check>
          <Field
            label="Check an amount" type="text" inputMode="decimal" autoComplete="off" placeholder="$ amount, like 25,000" value={checkAmount}
            onChange={(e) => setCheckAmount(e.target.value)}
            hint={String(checkAmount).trim() !== "" && amount == null ? "Type the amount as a number, like 25000." : "An advance you have in mind: how long would our fee take to pay it back?"}
          />
          {checked && <p className="adv-check-out" data-tone={checked.tone} data-adv-check-result role="status">{checked.text}</p>}
        </div>
      </> : <p className="hint adv-nofee" data-adv-nofee>At today's pace there's no fee to pay an advance back from.</p>}
      </>}
      </div>
      </div>

      {!empty && (
        <div className="adv-more">
          <div className="adv-ledgers">
            <div className="split-list" data-adv-ledger="theirs">
              <div className="split-list-row"><span className="split-name">Their earnings yr 1</span><span className="split-pct">{money(model.their[0])}</span></div>
              <div className="split-list-row"><span className="split-name">Their earnings yr 2</span><span className="split-pct">{money(model.their[1])}</span></div>
              <div className="split-list-row"><span className="split-name">Their earnings yr 3</span><span className="split-pct">{money(model.their[2])}</span></div>
              <div className="split-list-row split-list-total"><span>Their earnings next 3 yrs</span><span>{money(model.theirTotal)}</span></div>
            </div>
            <div className="split-list" data-adv-ledger="ours">
              <div className="split-list-row"><span className="split-name">Our fee yr 1</span><span className="split-pct">{money(model.ours[0])}</span></div>
              <div className="split-list-row"><span className="split-name">Our fee yr 2</span><span className="split-pct">{money(model.ours[1])}</span></div>
              <div className="split-list-row"><span className="split-name">Our fee yr 3</span><span className="split-pct">{money(model.ours[2])}</span></div>
              <div className="split-list-row split-list-total"><span>Our fee next 3 yrs</span><span>{money(model.oursTotal)}</span></div>
            </div>
          </div>

          {/* every number above, from the start, with this person's real figures in it */}
          <details className="adv-how" open data-adv-how>
            <summary>How we got these numbers</summary>
            <ul className="adv-how-list">
              <li data-how="pace">{`Today's pace: ${fmt(Math.round(model.pace))} streams a year (all platforms, their share). ${pace.source}`}</li>
              <li data-how="rate">{`× ${rateText} a stream: the sheet's blended publishing rate (ASSUMPTIONS!B7) = ${money(model.theirNow)} a year at today's pace.`}</li>
              <li data-how="slowdown">{decay > 0
                ? `Slows ${pct1(decay)} a year (ASSUMPTIONS!B8), so the next 12 months average ${pct1(model.year1Share)} of today's pace; each year after is ${pct1(1 - decay)} of the one before. (Our songs actually grew from August to October; ${pct1(decay)} is a careful assumption.)`
                : "No slowdown (ASSUMPTIONS!B8 is 0%), so every year earns today's pace."}</li>
              <li data-how="fee">{`Our fee is ${pct1(fee)} (ASSUMPTIONS!B11) = ${money(model.feeNow)} a year at today's pace. Advances pay back from our fee only, not the writer's share.`}</li>
              <li data-how="advance">{`The advance is what our fee adds up to over the ${monthsText(R)} you picked, slowdown included: ${money(model.recommended)}.`}</li>
              <li data-how="verdict">{verdictRule()}</li>
              <li data-how="sheet">{`The sheet's own ADVANCE CALCULATOR tab still uses the ${pct1(runRate)} rule for everyone, so its numbers differ.`}{links.advanceCalculator && <> <ExtLink href={links.advanceCalculator} className="inline-link">Open in sheet</ExtLink></>}</li>
            </ul>
          </details>
        </div>
      )}
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
// then B8 less each year: a rough guess, said so. (2026-11-20) It is the sheet's 30% rule for every writer, not the calculator's
// real pace above, so it's labelled as the sheet's and says it won't match.
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
      <h3 className="lm-h3">The sheet's forecast: our fee, next 3 years</h3>
      <p className="hint" data-forecast-note>The pub sheet's own forecast for the whole roster. It uses {y ? `the ${y.run} rule` : "one rule"} for every writer, not their real streams, so it won't match the calculator above{y ? `: ${y.share} of the fee so far in year 1, then ${y.decay} less a year` : ""}.</p>
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
