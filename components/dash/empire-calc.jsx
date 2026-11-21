import { useState, useEffect, useMemo } from "react";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { Field, money } from "./ui";
import { bigNum, pct1, yearOne } from "./ar-fmt";
import { useAct } from "./empire-api";
import { findByName } from "../site/data";
import { paceOfSongs, producerDeal } from "../../lib/empire-math";
import { VERDICTS, yearFactor } from "../../lib/advance-model";
import {
  amountOf, checkSentence, clampMonths, cutFromText, dealPayload, monthsText, paceSource, pctText, usd, usd0, verdictRule, verdictShown, verdictTone,
} from "./empire-data";

// The advance calculator (2026-11-21), moved here from Clients › Advance calculator into Money › EMPIRE deal, and rebuilt for how Defied now gives advances: out of the
// advance EMPIRE paid, to its own producers, for a single song or a whole catalog, paid back from that producer's royalties. Its math is lib/empire-math.js (the same
// advance model as before, run on the producer's royalties: Net Income × EMPIRE's payout × (1 − Defied's cut)); its rates, pace and the pot come from GET /api/empire
// (`data`). It starts from TODAY'S PACE (the streams a year the songs earn now): a producer's songs from real daily readings, song by song (lib/advance-pace.js), anyone else's
// from the pub sheet's rule, lifetime streams × the run-rate (ASSUMPTIONS!B9). "Save as a planned deal" files the result in Producer deals.
// The OUTREACH tab's own budget strip and its 'Advance given?' write left with the old screen: the pot and Producer deals above are the budget now.

// A measured pace counts when at least half of it is measured (lib/empire-math.js REAL_PACE_MIN), as the calculator always did.
const VerdictPill = ({ verdict }) => (verdict ? <span className="adv-pill" data-tone={verdictTone(verdict)} data-verdict={verdict}>{verdict.startsWith("Too high") ? "Too high" : verdict}</span> : null);
const BLANK_NEW = { name: "", gross: "", share: "" };

// the A&R prospects (name and the net streams the OUTREACH sheet works out), from the same read the old calculator used; an account without A&R, or a sheet that can't be
// read, just has none to pick. preset: the list, handed in (tests); then nothing is read.
const prospectsOf = (d) => (Array.isArray(d?.prospects) ? d.prospects.filter((p) => p.id).map((p) => ({ id: p.id, name: p.name || "", netStreams: Number(p.money?.netStreams) || 0 })) : null);
function useProspects(preset) {
  const [state, setState] = useState(() => ({ list: preset !== undefined ? preset : prospectsOf(peekJson("/api/ar-data")), err: false }));
  useEffect(() => {
    if (preset !== undefined) return undefined;
    let alive = true;
    swrJson("/api/ar-data", (d) => alive && setState({ list: prospectsOf(d), err: false }), { anyStatus: true, keep: (d) => !!d && !d.error && Array.isArray(d.prospects) })
      .then((d) => { if (alive && (!d || d.error)) setState((s) => ({ ...s, err: true })); })
      .catch(() => alive && setState((s) => ({ ...s, err: true })));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function EmpireCalc({ data, reload, init = null }) {
  const { levers: lev, terms, producers, defaults, pot } = data;
  const [who, setWho] = useState(init?.who ?? ""); // "" | "p:<client id>" | "o:<prospect id>" | "n" (someone new, typed)
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
  const prospects = useProspects(init?.prospects);

  const producer = who.startsWith("p:") ? producers.find((p) => p.id === who.slice(2)) : null;
  const prospect = who.startsWith("o:") ? (prospects.list || []).find((p) => p.id === who.slice(2)) : null;
  const picks = (scope === "songs" ? (producer?.songs || []).filter((s) => picked.has(s.id)) : producer?.songs || []);
  const netStreams = prospect ? prospect.netStreams : who === "n" ? (Number(typed.gross) || 0) * ((Number(typed.share) || 0) / 100) : 0;
  // nothing to work out yet: nobody picked, no streams typed, or a producer with no songs ticked
  const empty = (!producer && !prospect && !(who === "n" && netStreams > 0)) || (!!producer && picks.length === 0);

  // today's pace for who's picked, and where it comes from, in words
  const rulePct = pctText(lev?.runRate ?? 0);
  const pace = useMemo(() => {
    if (!lev?.ok) return null;
    if (producer) return paceSource({ p: paceOfSongs(picks.filter((s) => s.share > 0)), rule: lev.runRate, decay: lev.decayRate });
    return { real: false, perYear: netStreams * lev.runRate, warning: null, source: `Estimate: no daily tracking for their songs, so this uses the sheet's rule: lifetime streams × ${rulePct} a year.` };
  }, [lev, producer, scope, picked, netStreams]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = clampMonths(monthsIn), amount = amountOf(amountIn), cut = cutFromText(cutText);
  const m = useMemo(() => (lev?.ok && pace && cut != null
    ? producerDeal({ pace: pace.perYear, ni: lev.niPerStream, payout: terms.payout, cut, decay: lev.decayRate, months: R, amount, pot })
    : null), [lev, pace, cut, R, amount, terms, pot]);
  const checked = m ? checkSentence(m.check, m.ceiling) : null;
  const decay = lev?.decayRate ?? 0;

  // the deal to save: its advance is the one typed for it, else the amount being checked, else the advance shown
  const typedSave = amountOf(saveIn);
  const toSave = typedSave ?? amount ?? (m ? Math.round(m.advance * 100) / 100 : 0);
  const named = producer ? picks.length > 0 : prospect ? true : who === "n" ? typed.name.trim().length > 0 && netStreams > 0 : false;
  const canSave = !!m && cut != null && toSave > 0 && named;
  const save = () => {
    const body = dealPayload({ producer, prospectName: prospect ? prospect.name : typed.name.trim(), scope, songIds: picks.map((s) => s.id), advance: toSave, cut, note });
    return act(body, () => { setSaid(`Saved: ${usd(toSave)} for ${producer ? producer.name : body.prospectName}, as a planned deal. It's in Producer deals above.`); setSaveIn(""); setNote(""); });
  };
  const leftAfter = m && m.pot ? Math.round((pot.left - toSave) * 100) / 100 : null;

  const choose = (value) => {
    setWho(value); setSaid(null); clear(); setAmountIn(""); setSaveIn("");
    setScope("catalog"); setPicked(new Set());
  };
  const tick = (id) => setPicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <section className="emp-card emp-calc" data-emp="calc" aria-label="Advance calculator">
      <div className="emp-head"><h3 className="emp-h">Advance calculator</h3></div>
      <p className="emp-sub">How big an advance one of our producers' royalties can pay back, worked out from the streams their songs earn today. It's paid back from the producer's royalties (what's left after Defied's cut), and it comes out of the pot above.</p>
      <p className="hint adv-rate" data-emp-rate title="The rate is ASSUMPTIONS!B7 on the pub sheet">{lev?.ok ? `At $${+lev.blendedRate.toFixed(6)} a stream for the whole song (your pub sheet's rate).` : "At your pub sheet's rate a stream."}</p>
      {!lev?.ok && <p className="hint err-text" role="alert" data-emp-calc-off>Couldn't read the pub sheet's rates just now, so the calculator can't work out its numbers. Reload in a minute.</p>}

      <div className="adv-cols">
        <div className="form-card emp-calc-form">
          <label className="fld"><span>Producer or prospect</span>
            <select value={who} onChange={(e) => choose(e.target.value)} data-f="who">
              <option value="">— pick someone —</option>
              {producers.length > 0 && (
                <optgroup label="Our producers">
                  {producers.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.songs.length} {p.songs.length === 1 ? "song" : "songs"})</option>)}
                </optgroup>
              )}
              {(prospects.list || []).length > 0 && (
                <optgroup label="Prospects (A&R)">
                  {prospects.list.map((p) => <option key={p.id} value={`o:${p.id}`}>{p.name} ({bigNum(Math.round(p.netStreams))} net streams)</option>)}
                </optgroup>
              )}
              <option value="n">— someone new (type their streams) —</option>
            </select>
          </label>
          {prospects.err && !prospects.list && <p className="hint" data-emp-no-prospects>The A&R prospects couldn't be read just now (they need A&R access and the pub sheet), so only producers and someone new are listed.</p>}

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
                          <span className="emp-song-n" data-emp-song-pace>{s.share > 0 ? `${pctText(s.share, 0)} · ${bigNum(s.paceNet)} a year${s.kind === "real" ? "" : " (est.)"}` : "no split yet"}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>
          )}

          {prospect && <p className="hint" data-emp-hint-prospect>Net streams ({bigNum(Math.round(netStreams))}) come from {prospect.name}'s rows on the pub sheet's OUTREACH tab; edit them there to change this.</p>}
          {who === "n" && (
            <>
              <Field label="Name" value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value })} placeholder="Who are you looking at?" data-f="name" />
              <Field label="Gross streams" type="number" value={typed.gross} onChange={(e) => setTyped({ ...typed, gross: e.target.value })} data-f="gross" />
              <Field label="Writer %" type="number" value={typed.share} onChange={(e) => setTyped({ ...typed, share: e.target.value })} data-f="share" />
              {netStreams > 0 && <p className="hint">Net streams: {bigNum(Math.round(netStreams))}</p>}
            </>
          )}
          {/* where today's pace comes from: real daily streams for songs with enough of them, otherwise the sheet's rule */}
          {!empty && pace && <p className="hint adv-source" data-adv-source={pace.real ? "real" : "estimate"}>{pace.source}</p>}
          {!empty && pace?.warning && <p className="hint adv-warn" data-tone="warn" data-adv-warn role="note">{pace.warning}</p>}

          <Field
            label="Defied's cut (%)" inputMode="decimal" autoComplete="off" value={cutText} onChange={(e) => setCutText(e.target.value)} data-f="cut"
            hint={cut == null ? "Type a percent from 0 to 99.99." : `Defied keeps this share of what EMPIRE pays on these songs. The rest, ${pctText(1 - cut, 2)}, is the producer's royalties. The usual cut is ${pctText(defaults.cut, 0)}.`}
          />
          <Field
            label="Pay it back in (months)" type="number" min={1} max={120} value={monthsIn} onChange={(e) => setMonthsIn(e.target.value)} data-f="months"
            hint={`How fast the royalties should pay it back. Safe is ${VERDICTS[0][0]} months or less; past ${VERDICTS[VERDICTS.length - 1][0]} is too high.`}
          />
          {String(monthsIn ?? "").trim() !== "" && Number(monthsIn) !== R && <p className="hint" data-adv-clamp>Using {monthsText(R)} (it can be 1 to 120 months).</p>}
        </div>

        <div className="adv-out">
          {empty || !m ? <p className="adv-empty" data-emp-calc-empty>{!lev?.ok ? "Waiting for the pub sheet's rates." : cut == null ? "Type Defied's cut as a percent to see an advance." : who === "n" && Number(typed.gross) > 0 && !(Number(typed.share) > 0) ? "Add their writer share (%) to see an advance." : producer && picks.length === 0 ? "Tick at least one song to see an advance." : "Pick a producer or prospect, or type streams, to see an advance."}</p> : (
            <>
              <div className="cat-summary" data-adv-tiles>
                <div className="cat-summary-grid">
                  <div className="cat-stat" data-stat="advance"><span className="cat-stat-label">{`Advance that pays back in ${monthsText(R)}`}</span><span className="cat-stat-val">{money(m.advance)}</span>{m.advance > 0 && <VerdictPill verdict={verdictShown(R)} />}</div>
                  <div className="cat-stat" data-stat="royalties"><span className="cat-stat-label">Producer's royalties, next 12 months</span><span className="cat-stat-val">{money(m.next12.royalties)}</span><span className="adv-stat-sub">{decay > 0 ? `slowing ${pct1(decay)} a year` : "no slowdown"}</span></div>
                  <div className="cat-stat" data-stat="cut"><span className="cat-stat-label">Defied's cut, next 12 months</span><span className="cat-stat-val">{money(m.next12.defiedCut)}</span><span className="adv-stat-sub">{`${pctText(cut, 2)} of Defied's ${pctText(terms.payout, 0)}`}</span></div>
                  <div className="cat-stat" data-stat="toEmpire"><span className="cat-stat-label">{`Adds to EMPIRE's ${usd0(terms.owed)}, next 12 months`}</span><span className="cat-stat-val">{money(m.toEmpire.next12)}</span><span className="adv-stat-sub">{`all of Defied's ${pctText(terms.payout, 0)}`}</span></div>
                  <div className="cat-stat" data-stat="pace"><span className="cat-stat-label">Today's pace</span><span className="cat-stat-val">{bigNum(m.pace)}</span><span className="adv-stat-sub">{pace.real ? "streams a year, from daily counts" : "streams a year, an estimate"}</span></div>
                  <div className="cat-stat" data-stat="pot"><span className="cat-stat-label">Pot left after it</span><span className="cat-stat-val" data-over={m.pot.afterAdvance < 0 ? "" : undefined}>{usd(m.pot.afterAdvance)}</span><span className="adv-stat-sub">{`of ${usd0(terms.execution)}, ${usd0(pot.left)} left now`}</span></div>
                </div>
              </div>

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

              {m.royaltiesNow > 0 ? (
                <>
                  <div className="adv-block" data-adv-ladder>
                    <h3 className="adv-h">Advance for each payback time</h3>
                    <table className="adv-ladder">
                      <thead><tr><th scope="col">Pays back in</th><th scope="col">Advance</th><th scope="col">Verdict</th></tr></thead>
                      <tbody>
                        {m.ladder.map((r) => (
                          <tr key={r.months} data-ladder-months={r.months} data-chosen={r.months === R ? "" : undefined} aria-current={r.months === R ? "true" : undefined}>
                            <td>{monthsText(r.months)}</td><td>{money(r.advance)}</td><td><VerdictPill verdict={r.verdict} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="adv-block" data-adv-check>
                    <Field
                      label="Check an amount" type="text" inputMode="decimal" autoComplete="off" placeholder="$ amount, like 25,000" value={amountIn}
                      onChange={(e) => setAmountIn(e.target.value)} data-f="amount"
                      hint={String(amountIn).trim() !== "" && amount == null ? "Type the amount as a number, like 25000." : "An advance you have in mind: how long would the royalties take to pay it back?"}
                    />
                    {checked && <p className="adv-check-out" data-tone={checked.tone} data-adv-check-result role="status">{checked.text}</p>}
                  </div>
                </>
              ) : <p className="hint adv-nofee" data-adv-nofee>At this pace there are no royalties to pay an advance back from.</p>}

              <div className="adv-block" data-emp-save>
                <h3 className="adv-h">Save as a planned deal</h3>
                <Field label="Advance to save ($)" inputMode="decimal" autoComplete="off" placeholder={usd(toSave)} value={saveIn} onChange={(e) => setSaveIn(e.target.value)} data-f="saveAmount"
                  hint="Starts from the amount you're checking, or the advance above. Type another if the deal is different." />
                <Field label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-f="note" />
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

      {!empty && m && (
        <div className="adv-more">
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
          <details className="adv-how" open data-adv-how>
            <summary>How we got these numbers</summary>
            <ul className="adv-how-list">
              <li data-how="pace">{`Today's pace: ${Math.round(m.pace).toLocaleString("en-US")} streams a year (all platforms, their share). ${pace.source}`}</li>
              <li data-how="rate">{`× $${+lev.blendedRate.toFixed(6)} a stream: the pub sheet's rate for the whole song, writer and publisher (ASSUMPTIONS!B7) = ${usd(m.pace * lev.blendedRate)} a year at today's pace.`}</li>
              <li data-how="net">{`Net Income: EMPIRE receives ${pctText(lev.niShare, 1)} of that, the mechanicals and the publisher's half of performance = ${usd(m.now.ni)} a year${lev.niShareSet ? ` (a share a Founder set; the standard guess is ${pctText(lev.niStandard, 1)})` : ""}. The writer's own performance share isn't Net Income and isn't touched: it goes straight to Defied.`}</li>
              <li data-how="empire">{`EMPIRE keeps ${pctText(1 - terms.payout, 1)} of Net Income: ${usd(m.now.empire)} a year.`}</li>
              <li data-how="defied">{`Defied gets the other ${pctText(terms.payout, 1)}: ${usd(m.now.defied)} a year. All of it counts toward paying back EMPIRE's ${usd0(terms.owed)}, whoever it ends up with.`}</li>
              <li data-how="cut">{`Defied's cut is ${pctText(cut, 2)} of that: ${usd(m.now.defiedCut)} a year.`}</li>
              <li data-how="royalties">{`What's left, ${usd(m.now.royalties)} a year, is the producer's royalties. They pay back the producer's advance first.`}</li>
              <li data-how="slowdown">{decay > 0
                ? `Slows ${pct1(decay)} a year (ASSUMPTIONS!B8), so the next 12 months average ${pct1(yearFactor(decay, 1))} of today's pace; each year after is ${pct1(1 - decay)} of the one before. ${pct1(decay)} is a careful assumption; check it again once there's more history.`
                : "No slowdown (ASSUMPTIONS!B8 is 0%), so every year earns today's pace."}</li>
              <li data-how="advance">{`The advance is what the royalties add up to over the ${monthsText(R)} you picked, slowdown included: ${usd(m.advance)}.`}</li>
              <li data-how="adds">{producer ? `These songs add about ${usd(m.toEmpire.next12)} in the next 12 months toward EMPIRE's ${usd0(terms.owed)} and ${usd(m.toEmpire.next36)} over 3 years (all of Defied's ${pctText(terms.payout, 0)} counts, whatever the producer is owed).` : `Once their songs are on Schedule A they would add about ${usd(m.toEmpire.next12)} in the next 12 months toward EMPIRE's ${usd0(terms.owed)}.`}</li>
              <li data-how="verdict">{verdictRule()}</li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

// The pub sheet's own 3-year forecast of our fee (MASTER), for the roster and by writer (r7: it moved here from Publishing's Overview; 2026-11-21: it moved again, with the
// calculator, to Money › EMPIRE deal). The sheet's Year 1 is the fee so far × B9 × (1 − B8), then B8 less each year: a rough guess, said so. It is the sheet's 30% rule for every
// writer, not the calculator's real pace, so it says it won't match. Kept shut until it's opened, so the page asks the sheet for it only then.
export function SheetForecast({ db }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="emp-forecast" data-emp="forecast" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>The pub sheet's own forecast of our fee (its old rule, from before the EMPIRE deal)</summary>
      {open && <RosterForecast db={db} />}
    </details>
  );
}
export function RosterForecast({ db }) {
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
