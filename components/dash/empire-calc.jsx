import { useState, useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Field, money } from "./ui";
import { bigNum, pct1 } from "./ar-fmt";
import { useAct, useEmpire } from "./empire-api";
import { overlapOf, paceOfSongs, producerDeal } from "../../lib/empire-math";
import { yearFactor } from "../../lib/advance-model";
import {
  amountOf, checkSentence, clampMonths, cutFromText, dealPayload, monthsText, paceSource, pctText, usd, usd0, verdictRule, verdictShown, verdictTone,
} from "./empire-data";

// The advance calculator (2026-11-21), moved here from Clients › Advance calculator into Money, and rebuilt for how Defied now gives advances: out of the
// advance EMPIRE paid, to its own producers, for a single song or a whole catalog, paid back from that producer's royalties. Its math is lib/empire-math.js (the same
// advance model as before, run on the producer's royalties: Net Income × EMPIRE's payout × (1 − Defied's cut)); its rates, pace and the amount it plans against come from GET /api/empire
// (`data`). It starts from TODAY'S PACE (the streams a year the songs earn now): a producer's songs from real daily readings, song by song (lib/advance-pace.js), anyone else's
// from the pub sheet's rule, lifetime streams × the run-rate (ASSUMPTIONS!B9). "Save as a planned deal" files the result in Producer deals (Money › EMPIRE).
// It is a planning tool, so its numbers are estimates and say so. (2026-11-23) It has its own Money pill, Advance calculator (/dashboard/money/advance), AdvanceDeal below.
// (2026-11-24, the owner: "this is still a bit complicated like idk what all that means can we make all of it intuitive maybe less options like the old pub sheet stuff can go i wanna know like
// just the key information") Shown simple: who (a producer of ours, or someone new), how long to pay it back (chips) and Defied's cut in; one headline, "Up to $X", and three tiles out, with
// Check an amount and Save as a planned deal under them. Everything else is ONE closed fold, "Show the math". The A&R prospects in the picker and the pub sheet's own forecast are gone.

// Today's pace is song by song (lib/empire-math.js paceOfSongs): each measured song at its measured pace, the rest by the sheet's rule.
const VerdictPill = ({ verdict }) => (verdict ? <span className="adv-pill" data-tone={verdictTone(verdict)} data-verdict={verdict}>{verdict.startsWith("Too high") ? "Too high" : verdict}</span> : null);
const BLANK_NEW = { name: "", gross: "", share: "" };
// "Pay back in": the choices, in months. The box starts on the model's own default (defaults.months), which joins the row if it isn't one of them
const MONTH_CHIPS = [6, 12, 18, 24, 36];
const chipsFor = (dflt) => { const n = Number(dflt); return Number.isInteger(n) && n >= 1 && n <= 120 && !MONTH_CHIPS.includes(n) ? [...MONTH_CHIPS, n].sort((a, b) => a - b) : MONTH_CHIPS; };

export function EmpireCalc({ data, reload, init = null }) {
  const { levers: lev, terms, producers, defaults, pot, deals = [] } = data;
  const free = pot.free; // what is neither spent nor planned yet: the room a new deal is planned in
  const [who, setWho] = useState(init?.who ?? ""); // "" | "p:<client id>" | "n" (someone new, typed)
  const [typed, setTyped] = useState(init?.typed ?? BLANK_NEW);
  const [scope, setScope] = useState(init?.scope ?? "catalog"); // a producer's: "catalog" | "songs"
  const [picked, setPicked] = useState(() => new Set(init?.picked ?? []));
  const [cutText, setCutText] = useState(init?.cut ?? String(Math.round(defaults.cut * 10000) / 100));
  const [monthsIn, setMonthsIn] = useState(init?.months ?? String(defaults.months));
  const [amountIn, setAmountIn] = useState(init?.amount ?? ""); // an advance typed to check
  const [saveIn, setSaveIn] = useState(init?.saveAmount ?? ""); // the advance to save, when it isn't the one shown
  const [note, setNote] = useState(init?.note ?? "");
  const [said, setSaid] = useState(init?.said ?? null);
  const { busy, err, act, clear } = useAct(reload);

  const producer = who.startsWith("p:") ? producers.find((p) => p.id === who.slice(2)) : null;
  const picks = (scope === "songs" ? (producer?.songs || []).filter((s) => picked.has(s.id)) : producer?.songs || []);
  const netStreams = who === "n" ? (Number(typed.gross) || 0) * ((Number(typed.share) || 0) / 100) : 0;
  // nothing to work out yet: nobody picked, no streams typed, or a producer with no songs ticked
  const empty = (!producer && !(who === "n" && netStreams > 0)) || (!!producer && picks.length === 0);

  // today's pace for who's picked, and where it comes from, in words
  const rulePct = pctText(lev?.runRate ?? 0);
  const pace = useMemo(() => {
    if (!lev?.ok) return null;
    if (producer) return paceSource({ p: paceOfSongs(picks.filter((s) => s.share > 0)), rule: lev.runRate, decay: lev.decayRate, heldNames: picks.filter((s) => s.share > 0 && s.launch).map((s) => s.song) });
    return { real: false, perYear: netStreams * lev.runRate, warning: null, source: `Estimate: no daily tracking for their songs, so this uses the sheet's rule: lifetime streams × ${rulePct} a year.` };
  }, [lev, producer, scope, picked, netStreams]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = clampMonths(monthsIn), amount = amountOf(amountIn), cut = cutFromText(cutText);
  // the new songs held down (lib/advance-pace.js songPace), named with their measured launch pace and what they count as, for "Show the math"
  const heldSongs = producer ? picks.filter((s) => s.share > 0 && s.launch) : [];
  const heldWords = heldSongs.length ? ` New ${heldSongs.length === 1 ? "song" : "songs"} held down: ${heldSongs.map((s) => `“${s.song}” ${bigNum(s.measuredNet)} a year at launch, counted as ${bigNum(s.paceNet)}`).join("; ")}.` : "";

  // (2026-11-21, review) A producer who already has a deal on a song these picks cover has those royalties spoken for: what is still to pay back on that deal (its estimate: a planned
  // deal's whole advance, a given one's what the royalties since its day haven't covered) comes off the advance recommended here, never below 0. Deals on other songs don't count.
  // (2026-11-24, audit) "Check an amount" stacks the amount on it too, so the check, the headline and the ladder agree.
  const live = new Set((producer?.songs || []).map((s) => s.id));
  const existing = producer ? deals.filter((d) => overlapOf({ clientId: producer.id, scope, placementIds: picks.map((s) => s.id) }, d, live)) : [];
  const held = existing.reduce((a, d) => a + (Number(d.advance) || 0), 0), owing = existing.reduce((a, d) => a + (Number(d.owing ?? d.advance) || 0), 0);
  const m = useMemo(() => (lev?.ok && pace && cut != null
    ? producerDeal({ pace: pace.perYear, ni: lev.niPerStream, payout: terms.payout, cut, decay: lev.decayRate, months: R, amount, owing, pot: { left: free } })
    : null), [lev, pace, cut, R, amount, owing, terms, free]);
  const checked = m ? checkSentence(m.check, m.ceiling) : null;
  const decay = lev?.decayRate ?? 0;
  const adv = m ? Math.max(0, m.advance - owing) : 0; // the advance that is left for a new deal
  const potAfter = m && m.pot ? free - adv : null;

  // the deal to save: its advance is the one typed for it, else the amount being checked, else the advance shown
  const typedSave = amountOf(saveIn);
  const toSave = typedSave ?? amount ?? (m ? Math.round(adv * 100) / 100 : 0);
  const named = producer ? picks.length > 0 : who === "n" ? typed.name.trim().length > 0 && netStreams > 0 : false;
  const canSave = !!m && cut != null && toSave > 0 && named;
  const save = () => {
    const body = dealPayload({ producer, prospectName: typed.name.trim(), scope, songIds: picks.map((s) => s.id), advance: toSave, cut, note });
    return act(body, () => { setSaid(`Saved: ${usd(toSave)} for ${producer ? producer.name : body.prospectName}, as a planned deal. It's in Producer deals on the EMPIRE page.`); setSaveIn(""); setNote(""); });
  };
  const leftAfter = m && m.pot ? Math.round((free - toSave) * 100) / 100 : null;

  const choose = (value) => {
    setWho(value); setSaid(null); clear(); setAmountIn(""); setSaveIn("");
    setScope("catalog"); setPicked(new Set());
  };
  const tick = (id) => setPicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <section className="emp-card emp-calc" data-emp="calc" aria-label="Advance calculator">
      <div className="emp-head"><h3 className="emp-h">Advance calculator</h3></div>
      <p className="emp-sub" data-emp-calc-sub>How big an advance one of our producers can get, paid back from their royalties, out of EMPIRE's {usd0(terms.execution)} advance.</p>
      {!lev?.ok && <p className="hint err-text" role="alert" data-emp-calc-off>Couldn't load the rates just now, so the calculator can't work out its numbers. Reload in a minute.</p>}

      <div className="adv-cols">
        <div className="form-card emp-calc-form">
          <label className="fld"><span>Producer</span>
            <select value={who} onChange={(e) => choose(e.target.value)} data-f="who">
              <option value="">— pick someone —</option>
              {producers.length > 0 && (
                <optgroup label="Our producers">
                  {producers.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.songs.length} {p.songs.length === 1 ? "song" : "songs"})</option>)}
                </optgroup>
              )}
              <option value="n">Someone new (type their streams)</option>
            </select>
          </label>

          {producer && (
            <fieldset className="emp-scope" data-emp-scope>
              <legend>Which songs</legend>
              <label className="emp-radio"><input type="radio" name="emp-scope" checked={scope === "catalog"} onChange={() => setScope("catalog")} data-f="scopeCatalog" /> <span>The whole catalog ({producer.songs.length} {producer.songs.length === 1 ? "song" : "songs"})</span></label>
              <label className="emp-radio"><input type="radio" name="emp-scope" checked={scope === "songs"} onChange={() => setScope("songs")} data-f="scopeSongs" /> <span>Pick songs</span></label>
              {scope === "songs" && (
                <>
                  <p className="emp-songs-acts">
                    <button type="button" className="inline-link" data-emp-all onClick={() => setPicked(new Set(producer.songs.map((s) => s.id)))}>Pick all</button> · <button type="button" className="inline-link" data-emp-none onClick={() => setPicked(new Set())}>None</button> <span data-emp-picked>{picked.size} picked</span>
                  </p>
                  <ul className="emp-songs" data-emp-songs>
                    {producer.songs.map((s) => (
                      <li key={s.id} data-song={s.id}>
                        <label>
                          <input type="checkbox" checked={picked.has(s.id)} onChange={() => tick(s.id)} aria-label={s.song} />
                          <span className="emp-song-t"><b>{s.song}</b>{s.artist && <em> {s.artist}</em>}</span>
                          <span className="emp-song-n" data-emp-song-pace>{s.share > 0 ? `${pctText(s.share, 0)} · ${bigNum(s.paceNet)} a year${s.kind !== "real" ? " (est.)" : s.launch ? " (new, rough)" : ""}` : "no split yet"}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>
          )}

          {who === "n" && (
            <>
              <Field label="Name" value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value })} placeholder="Who are you looking at?" data-f="name" />
              {/* (2026-11-24, audit) the pace for someone new is the sheet's rule, lifetime streams × the run-rate, so this box is their LIFETIME streams: it said "Gross streams",
                  and a year's streams typed in came out at 30% of what they should */}
              <Field label="Lifetime streams (all platforms)" type="number" value={typed.gross} onChange={(e) => setTyped({ ...typed, gross: e.target.value })} data-f="gross"
                hint="Their all-time total on every platform, not a year's streams." />
              <Field label="Writer %" type="number" value={typed.share} onChange={(e) => setTyped({ ...typed, share: e.target.value })} data-f="share" />
              {netStreams > 0 && <p className="hint">Their share, lifetime: {bigNum(Math.round(netStreams))} streams</p>}
            </>
          )}
          {!empty && pace?.warning && <p className="hint adv-warn" data-tone="warn" data-adv-warn role="note">{pace.warning}</p>}
          {!empty && existing.length > 0 && <p className="hint adv-warn" data-tone="warn" data-emp-has-deal role="note">{existing.length === 1 ? `Already has a ${usd(held)} deal (${usd(owing)} still to pay back, estimated)` : `Already has ${existing.length} deals worth ${usd(held)} (${usd(owing)} still to pay back, estimated)`}</p>}

          <div className="fld emp-chipfld" role="group" aria-labelledby="adv-months-label">
            <span id="adv-months-label">Pay back in<span className="emp-unit-l"> (months)</span></span>
            <div className="emp-chips" data-adv-months>
              {chipsFor(defaults.months).map((n) => (
                <button key={n} type="button" className={R === n ? "subpill active" : "subpill"} aria-pressed={R === n} data-months={n} onClick={() => setMonthsIn(String(n))}>{n}</button>
              ))}
              <span className="emp-chips-unit">months</span>
            </div>
          </div>
          <Field
            label="Defied's cut (%)" inputMode="decimal" autoComplete="off" value={cutText} onChange={(e) => setCutText(e.target.value)} data-f="cut" className="adv-cut"
            hint={cut == null ? "Type a percent from 0 to 99.99." : `usually ${pctText(defaults.cut, 0)}`}
          />
        </div>

        <div className="adv-out">
          {empty || !m ? <p className="adv-empty" data-emp-calc-empty>{!lev?.ok ? "Loading the rates…" : cut == null ? "Type Defied's cut as a percent to see an advance." : who === "n" && Number(typed.gross) > 0 && !(Number(typed.share) > 0) ? "Add their writer share (%) to see an advance." : producer && picks.length === 0 ? "Tick at least one song to see an advance." : "Pick a producer, or type streams, to see an advance."}</p> : (
            <>
              <div className="adv-headline" data-adv-headline>
                <p className="adv-head-line"><span className="adv-head-up">Up to</span> <span className="adv-head-n" data-adv-headline-n>{money(adv)}</span></p>
                <p className="adv-head-sub" data-adv-headline-sub><span>{`paid back in ${monthsText(R)}`}</span>{adv > 0 && <VerdictPill verdict={verdictShown(R)} />}</p>
                {owing > 0 && <p className="adv-stat-sub" data-adv-owing>{`after the ${usd(owing)} still to pay back`}</p>}
              </div>
              <div className="cat-summary" data-adv-tiles>
                <div className="cat-summary-grid">
                  <div className="cat-stat" data-stat="royalties"><span className="cat-stat-label">Their royalties, next 12 months</span><span className="cat-stat-val">{money(m.next12.royalties)}</span></div>
                  <div className="cat-stat" data-stat="cut"><span className="cat-stat-label">Defied's cut, next 12 months</span><span className="cat-stat-val">{money(m.next12.defiedCut)}</span></div>
                  <div className="cat-stat" data-stat="pot"><span className="cat-stat-label">{`Left of the ${usd0(terms.execution)} after this`}</span><span className="cat-stat-val" data-over={potAfter < 0 ? "" : undefined}>{usd(potAfter)}</span></div>
                </div>
              </div>

              {m.royaltiesNow > 0 ? (
                <div className="adv-block adv-compact" data-adv-check>
                  <Field
                    label="Check an amount" type="text" inputMode="decimal" autoComplete="off" placeholder="$ amount, like 25,000" value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)} data-f="amount"
                    hint={String(amountIn).trim() !== "" && amount == null ? "Type the amount as a number, like 25000." : "An advance you have in mind: how long would the royalties take to pay it back?"}
                  />
                  {checked && <p className="adv-check-out" data-tone={checked.tone} data-adv-check-result role="status">{checked.text}</p>}
                </div>
              ) : <p className="hint adv-nofee" data-adv-nofee>At this pace there are no royalties to pay an advance back from.</p>}

              <div className="adv-block adv-compact" data-emp-save>
                <h3 className="adv-h">Save as a planned deal</h3>
                <div className="adv-save-fields">
                  <Field label="Advance to save ($)" inputMode="decimal" autoComplete="off" placeholder={usd(toSave)} value={saveIn} onChange={(e) => setSaveIn(e.target.value)} data-f="saveAmount"
                    hint="Starts from the amount you're checking, or the advance above. Type another if the deal is different." />
                  <Field label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-f="note" />
                </div>
                <button type="button" className="btn sm" data-emp-save-planned onClick={save} disabled={busy || !canSave}>{busy ? "Saving…" : "Save as a planned deal"}</button>
                {leftAfter != null && toSave > 0 && <p className="hint" data-emp-left-after data-over={leftAfter < 0 ? "" : undefined}>{leftAfter < 0 ? `That's ${usd(-leftAfter)} more than is left of the ${usd0(terms.execution)}.` : `${usd(leftAfter)} would be left of the ${usd0(terms.execution)}.`}</p>}
                {who === "n" && !typed.name.trim() && <p className="hint">Type their name above to save a deal for them.</p>}
                {producer && scope === "songs" && picks.length === 0 && <p className="hint">Tick at least one song to save a deal.</p>}
                {err && <p className="hint err-text" role="alert" data-emp-err>{err}</p>}
                {said && <p className="hint ok-text" role="status" data-emp-saved>{said}</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* everything else, in one closed fold: what counts toward EMPIRE, today's pace and where it comes from, the rate, where each dollar goes, the payback ladder, the 3-year ledgers and every step */}
      {!empty && m && (
        <details className="emp-fc adv-math" data-adv-math>
          <summary>Show the math</summary>
          <div className="emp-fc-body adv-math-body">
            <div className="cat-summary" data-adv-math-tiles>
              <div className="cat-summary-grid">
                <div className="cat-stat" data-stat="toEmpire"><span className="cat-stat-label">{producer ? `Counts toward EMPIRE's ${usd0(terms.owed)} (already on Schedule A), next 12 months` : `Adds to EMPIRE's ${usd0(terms.owed)}, next 12 months`}</span><span className="cat-stat-val">{money(m.toEmpire.next12)}</span><span className="adv-stat-sub">{`all of Defied's ${pctText(terms.payout, 0)}`}</span></div>
                <div className="cat-stat" data-stat="pace"><span className="cat-stat-label">Today's pace</span><span className="cat-stat-val">{bigNum(m.pace)}</span><span className="adv-stat-sub">{pace.real ? "streams a year, from daily counts" : "streams a year, an estimate"}</span></div>
              </div>
            </div>
            {/* where today's pace comes from: real daily streams for songs with enough of them, otherwise the sheet's rule */}
            <p className="hint adv-source" data-adv-source={pace.real ? "real" : "estimate"}>{pace.source}</p>
            <p className="hint adv-rate" data-emp-rate title="The rate is ASSUMPTIONS!B7 on the pub sheet">{`At $${+lev.blendedRate.toFixed(6)} a stream for the whole song (your pub sheet's rate).`}</p>

            <div className="adv-block" data-emp-flow>
              <h3 className="adv-h">Where each dollar of Net Income goes</h3>
              <div className="emp-bar emp-flow" role="img" aria-label={`EMPIRE keeps ${pctText(m.perDollar.empire, 1)}, Defied's cut ${pctText(m.perDollar.defiedCut, 1)}, the producer's royalties ${pctText(m.perDollar.producer, 1)}`}>
                <span className="emp-seg emp-seg-empire" style={{ width: `${Math.round(m.perDollar.empire * 1000) / 10}%` }} />
                <span className="emp-seg emp-seg-cut" style={{ width: `${Math.round(m.perDollar.defiedCut * 1000) / 10}%` }} />
                <span className="emp-seg emp-seg-prod" style={{ width: `${Math.round(m.perDollar.producer * 1000) / 10}%` }} />
              </div>
              <ul className="emp-legend" data-emp-flow-legend>
                <li><i className="emp-sw emp-sw-empire" aria-hidden="true" /> EMPIRE keeps <b>{pctText(m.perDollar.empire, 1)}</b> <em>{usd(m.now.empire)} a year</em></li>
                <li><i className="emp-sw emp-sw-cut" aria-hidden="true" /> Defied's cut <b>{pctText(m.perDollar.defiedCut, 1)}</b> <em>{usd(m.now.defiedCut)} a year</em></li>
                <li><i className="emp-sw emp-sw-prod" aria-hidden="true" /> Producer's royalties <b>{pctText(m.perDollar.producer, 1)}</b> <em>{usd(m.now.royalties)} a year</em></li>
              </ul>
            </div>

            {m.royaltiesNow > 0 && (
              <div className="adv-block" data-adv-ladder>
                <h3 className="adv-h">{owing > 0 ? `Advance for each payback time, after the ${usd(owing)} still to pay back` : "Advance for each payback time"}</h3>
                <table className="adv-ladder">
                  <thead><tr><th scope="col">Pays back in</th><th scope="col">Advance</th><th scope="col">Verdict</th></tr></thead>
                  <tbody>
                    {m.ladder.map((r) => (
                      <tr key={r.months} data-ladder-months={r.months} data-chosen={r.months === R ? "" : undefined} aria-current={r.months === R ? "true" : undefined}>
                        <td>{monthsText(r.months)}</td><td>{money(Math.max(0, r.advance - owing))}</td><td><VerdictPill verdict={owing > 0 && r.advance - owing <= 0 ? null : r.verdict} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="adv-ledgers">
              <div className="split-list" data-adv-ledger="net">
                {m.years.ni.map((x, i) => <div key={i} className="split-list-row"><span className="split-name">{`Net Income yr ${i + 1}`}</span><span className="split-pct">{money(x)}</span></div>)}
                <div className="split-list-row split-list-total"><span>Net Income next 3 yrs</span><span>{money(m.years.ni.reduce((a, b) => a + b, 0))}</span></div>
              </div>
              <div className="split-list" data-adv-ledger="royalties">
                {m.years.royalties.map((x, i) => <div key={i} className="split-list-row"><span className="split-name">{`Producer's royalties yr ${i + 1}`}</span><span className="split-pct">{money(x)}</span></div>)}
                <div className="split-list-row split-list-total"><span>Royalties next 3 yrs</span><span>{money(m.years.royalties.reduce((a, b) => a + b, 0))}</span></div>
              </div>
            </div>

            {/* every number above, from the start, with this deal's figures in it */}
            <div className="adv-block adv-how" data-adv-how>
              <h3 className="adv-h">How we got these numbers</h3>
              <ul className="adv-how-list">
                <li data-how="pace">{`Today's pace: ${Math.round(m.pace).toLocaleString("en-US")} streams a year (all platforms, their share). ${pace.source}${heldWords}`}</li>
                <li data-how="rate">{`× $${+lev.blendedRate.toFixed(6)} a stream: the pub sheet's rate for the whole song, writer and publisher (ASSUMPTIONS!B7) = ${usd(m.pace * lev.blendedRate)} a year at today's pace.`}</li>
                <li data-how="net">{`Net Income: EMPIRE receives ${pctText(lev.niShare, 1)} of that, the mechanicals and the publisher's half of performance = ${usd(m.now.ni)} a year${lev.niShareSet ? ` (a share a Founder set; the standard guess is ${pctText(lev.niStandard, 1)})` : ""}. The writer's share of performance royalties isn't part of this: it's paid to the writer through their PRO, outside the deal. This is before EMPIRE's collection fees (the contract caps them at ${pctText(terms.feeCap, 0)}).`}</li>
                <li data-how="empire">{`EMPIRE keeps ${pctText(1 - terms.payout, 1)} of Net Income: ${usd(m.now.empire)} a year.`}</li>
                <li data-how="defied">{`Defied gets the other ${pctText(terms.payout, 1)}: ${usd(m.now.defied)} a year. All of it counts toward paying back EMPIRE's ${usd0(terms.owed)}, whoever it ends up with.`}</li>
                <li data-how="cut">{`Defied's cut is ${pctText(cut, 2)} of that: ${usd(m.now.defiedCut)} a year.`}</li>
                <li data-how="royalties">{`What's left, ${usd(m.now.royalties)} a year, is the producer's royalties. They pay back the producer's advance first.`}</li>
                <li data-how="slowdown">{decay > 0
                  ? `Slows ${pct1(decay)} a year (ASSUMPTIONS!B8), so the next 12 months average ${pct1(yearFactor(decay, 1))} of today's pace; each year after is ${pct1(1 - decay)} of the one before. ${pct1(decay)} is a careful assumption; check it again once there's more history.`
                  : "No slowdown (ASSUMPTIONS!B8 is 0%), so every year earns today's pace."}</li>
                <li data-how="advance">{`The advance is what the royalties add up to over the ${monthsText(R)} you picked, slowdown included: ${usd(m.advance)}${owing > 0 ? `. The deal above still has ${usd(owing)} to pay back out of the same royalties, so ${usd(adv)} is left for a new one` : ""}.`}</li>
                <li data-how="adds">{producer ? `These songs already count toward EMPIRE's ${usd0(terms.owed)} (they're on Schedule A): about ${usd(m.toEmpire.next12)} in the next 12 months and ${usd(m.toEmpire.next36)} over 3 years (all of Defied's ${pctText(terms.payout, 0)} counts, whatever the producer is owed).` : `Once their songs are on Schedule A they would add about ${usd(m.toEmpire.next12)} in the next 12 months toward EMPIRE's ${usd0(terms.owed)}.`}</li>
                <li data-how="verdict">{verdictRule()}</li>
              </ul>
            </div>
          </div>
        </details>
      )}
    </section>
  );
}

// The Money › Advance calculator pill (2026-11-23): the calculator on a page of its own. It reads GET /api/empire itself (the rates, each producer's songs, the deals and the advance it plans against),
// kept for the tab like the EMPIRE page's read; a save is a planned deal, which the EMPIRE pill lists under Producer deals. (2026-11-24: the pub sheet's own forecast that used to sit under it is gone.)
export function AdvanceDeal() {
  const { data, err, load, retry } = useEmpire();
  if (!data) {
    return err
      ? <p className="home-muted" role="alert" data-emp-error><AlertTriangle size={15} /> <span>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></span></p>
      : <p className="home-muted" data-emp-loading><RefreshCw size={15} className="spin" /> Loading…</p>;
  }
  return (
    <>
      {err && <p className="hint err-text" role="alert" data-emp-error>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></p>}
      <AdvanceView data={data} reload={load} />
    </>
  );
}
// the page, drawn from the answer it was handed (init: the calculator's own presets, for the tests and the screenshots)
export function AdvanceView({ data, reload, init = null }) {
  return (
    <div className="emp-page" data-empire-advance>
      <EmpireCalc data={data} reload={reload} init={init} />
    </div>
  );
}
