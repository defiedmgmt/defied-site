// (2026-11-21) What the founders keep about the EMPIRE deal, in the one app_state row "empireDeal" (no new table). Server-only, CONFIDENTIAL.
// The row is ONE flat object, an entry per thing, so two founders saving at once never overwrite each other (the idiom of lib/auto-add.js remember: a write
// merges its own key into the object inside one SQL statement, and a delete removes only its own key):
//   "received"           { on, at, by, when }                   the execution advance reached the bank (yes / no and the day)
//   "levers"             { niShare, by, when }                  the share of whole-song publishing counted as Net Income, when a Founder changed it
//   "statement:2026Q3"   { quarter, netIncome, credited, enteredBy, at }   one EMPIRE statement, typed in
//   "deal:<id>"          { id, clientId, prospectName, scope, placementIds, advance, cut, status, givenOn, note, by, at, updatedBy?, updatedAt? }  a producer deal
// normalizeState turns the row into { received, levers, statements: [...], deals: [...] } (the shape the page and lib/empire-deal.js use), cleaning whatever is
// stored. Every check* function is pure: it answers { value } or { error } (an error is a sentence for the person who typed it); nothing is saved without one.
import { sql } from "./db";
import { uid } from "./id";
import { DEAL, DEFAULT_CUT, NI_SHARE_RANGE, quarterRange, validQuarter, validYmd, addDays } from "./empire-terms";
import { cents, cutOf } from "./empire-math";

export const KEY = "empireDeal";
export const LIMITS = { deals: 200, statements: 40, songs: 500, advance: 1000000, statement: 100000000 };
const str = (v, n) => String(v ?? "").slice(0, n);
const cleanMoney = (v) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n >= 0 ? cents(n) : null; };

// ---- reading
export function normalizeState(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const statements = [], deals = [];
  for (const [k, e] of Object.entries(v)) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (k.startsWith("statement:")) {
      const quarter = k.slice(10), netIncome = cleanMoney(e.netIncome), credited = cleanMoney(e.credited);
      if (validQuarter(quarter) && netIncome != null && credited != null) statements.push({ quarter, netIncome, credited, enteredBy: str(e.enteredBy, 80), at: str(e.at, 40) });
    } else if (k.startsWith("deal:")) {
      const id = k.slice(5), advance = cleanMoney(e.advance);
      if (!id || advance == null || advance <= 0) continue;
      deals.push({
        id, clientId: str(e.clientId, 60) || null, prospectName: str(e.prospectName, 120), scope: e.scope === "songs" ? "songs" : "catalog",
        placementIds: Array.isArray(e.placementIds) ? [...new Set(e.placementIds.map((x) => str(x, 60)).filter(Boolean))].slice(0, LIMITS.songs) : [],
        advance, cut: e.cut == null || !Number.isFinite(Number(e.cut)) ? DEFAULT_CUT : cutOf(e.cut),
        status: e.status === "given" ? "given" : "planned", givenOn: e.status === "given" && validYmd(e.givenOn) ? e.givenOn : null,
        note: str(e.note, 500), by: str(e.by, 80), at: str(e.at, 40), updatedBy: str(e.updatedBy, 80), updatedAt: str(e.updatedAt, 40),
      });
    }
  }
  statements.sort((a, b) => a.quarter.localeCompare(b.quarter));
  // given ones first (the newest day first), then the planned ones (the newest first)
  deals.sort((a, b) => (a.status === b.status ? 0 : a.status === "given" ? -1 : 1) || (a.status === "given" ? String(b.givenOn || "").localeCompare(String(a.givenOn || "")) : 0) || String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
  const r = v.received && typeof v.received === "object" ? v.received : {};
  const niShare = Number(v.levers?.niShare);
  return {
    received: { on: r.on === true, at: r.on === true && validYmd(r.at) ? r.at : null, by: str(r.by, 80), when: str(r.when, 40) },
    levers: { niShare: Number.isFinite(niShare) && niShare >= NI_SHARE_RANGE[0] && niShare <= NI_SHARE_RANGE[1] ? niShare : null, by: str(v.levers?.by, 80), when: str(v.levers?.when, 40) },
    statements, deals,
  };
}
export async function readState() {
  const [row] = await sql`SELECT value FROM app_state WHERE key = ${KEY}`;
  return normalizeState(row?.value);
}

// ---- writing: each one is a single SQL statement on its own key of the object, so concurrent saves merge
// create or replace one entry
export async function putEntry(k, entry) {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, jsonb_build_object(${k}::text, ${JSON.stringify(entry)}::jsonb), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
}
// create an entry only if that key isn't there yet: true when this call made it (the check and the write are one statement)
export async function putIfAbsent(k, entry) {
  const rows = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, jsonb_build_object(${k}::text, ${JSON.stringify(entry)}::jsonb), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now() WHERE app_state.value -> ${k}::text IS NULL RETURNING key`;
  return rows.length > 0;
}
// change some fields of an entry that is there: its new whole entry, or null when it isn't there (deleted meanwhile)
export async function patchEntry(k, patch) {
  const rows = await sql`UPDATE app_state SET value = value || jsonb_build_object(${k}::text, (value -> ${k}::text) || ${JSON.stringify(patch)}::jsonb), updated_at = now()
    WHERE key = ${KEY} AND value -> ${k}::text IS NOT NULL RETURNING value -> ${k}::text AS entry`;
  return rows[0]?.entry ?? null;
}
// remove an entry: true when it was there
export async function dropEntry(k) {
  const rows = await sql`UPDATE app_state SET value = value - ${k}::text, updated_at = now() WHERE key = ${KEY} AND value -> ${k}::text IS NOT NULL RETURNING key`;
  return rows.length > 0;
}

export const addStatement = (s) => putIfAbsent(`statement:${s.quarter}`, s);
export const dropStatement = (quarter) => dropEntry(`statement:${quarter}`);
export const setReceived = (r) => putEntry("received", r);
export const setLevers = (l) => (l ? putEntry("levers", l) : dropEntry("levers"));
export const patchDeal = (id, patch) => patchEntry(`deal:${id}`, patch);
export const dropDeal = (id) => dropEntry(`deal:${id}`);
// a new deal under a fresh id (a clash with an existing one tries another id)
export async function createDeal(fields) {
  for (let i = 0; i < 4; i++) {
    const id = uid();
    const deal = { id, ...fields };
    if (await putIfAbsent(`deal:${id}`, deal)) return deal;
  }
  throw new Error("couldn't find a free id for the deal");
}

// ---- checking what was typed (pure). Money in dollars, to the cent; a cut is a fraction (0.2 = 20%).
const num = (v) => (typeof v === "number" ? v : v == null || v === "" ? NaN : Number(String(v).replace(/[$,\s]/g, "")));

// one quarter's statement: { quarter, netIncome, credited }. today: the New York day. taken: the quarters that already have one
export function checkStatement(b, { today, taken = [] }) {
  const quarter = str(b?.quarter, 12).trim().toUpperCase();
  if (!validQuarter(quarter)) return { error: "Pick the quarter the statement is for, like 2026Q4." };
  const r = quarterRange(quarter);
  if (r.end < DEAL.effective) return { error: `${quarter} ended before the deal started, so there's no statement for it.` };
  if (r.end >= today) return { error: `${quarter} isn't over yet (it ends ${r.end}), so EMPIRE hasn't sent a statement for it.` };
  if (taken.includes(quarter)) return { error: `${quarter} already has a statement. Delete it first to enter it again.` };
  const netIncome = num(b?.netIncome), credited = num(b?.credited);
  if (!(netIncome >= 0)) return { error: "Net Income needs to be a dollar amount, like 4250.10 (0 is fine)." };
  if (!(credited >= 0)) return { error: "Credited to Defied needs to be a dollar amount, like 3400.08 (0 is fine)." };
  if (netIncome > LIMITS.statement || credited > LIMITS.statement) return { error: "Those amounts look too big. Check the digits." };
  if (cents(credited) > cents(netIncome)) return { error: "Credited to Defied can't be more than the Net Income. Check the two amounts aren't swapped." };
  return { value: { quarter, netIncome: cents(netIncome), credited: cents(credited) } };
}

// a producer deal, whole. base: the deal as it is now (an edit: whatever isn't typed stays), or null for a new one. owners: Map clientId -> { name, ids: Set of
// the placement ids on Schedule A }. -> { value: { clientId, prospectName, scope, placementIds, advance, cut, status, givenOn, note } }
export function checkDeal(b, { today, owners, base = null }) {
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
  const pick = (k, dflt) => (has(k) ? b[k] : base ? base[k] : dflt);
  const clientId = str(pick("clientId", ""), 60).trim(), prospect = str(pick("prospectName", ""), 120).trim();
  if (has("clientId") && has("prospectName") && clientId && prospect) return { error: "A deal is for a producer or for a prospect, not both." };
  // linking a prospect's deal to a producer replaces the typed name
  const linked = has("clientId") && clientId ? "" : prospect;
  if (!clientId && !linked) return { error: "Pick a producer, or type the prospect's name." };
  const owner = clientId ? owners.get(clientId) : null;
  if (clientId && !owner) return { error: "That isn't a producer on Schedule A." };
  const scope = clientId ? String(pick("scope", "catalog")) : "catalog";
  if (scope !== "catalog" && scope !== "songs") return { error: "Choose the whole catalog or some songs." };
  let placementIds = [];
  if (scope === "songs") {
    const ids = pick("placementIds", []);
    if (!Array.isArray(ids)) return { error: "Pick the songs the deal covers." };
    placementIds = [...new Set(ids.map((x) => str(x, 60)).filter(Boolean))];
    if (!placementIds.length) return { error: "Pick at least one song, or choose the whole catalog." };
    if (placementIds.length > LIMITS.songs) return { error: `That's more than ${LIMITS.songs} songs.` };
    // songs picked now must be on Schedule A under this producer; an edit that leaves the songs alone keeps them even if one has left Schedule A since
    const kept = !!base && !has("placementIds") && !has("clientId") && base.clientId === clientId;
    if (!kept && !placementIds.every((id) => owner.ids.has(id))) return { error: `One of those songs isn't ${owner.name}'s on Schedule A (any more).` };
  }
  const advance = num(pick("advance", ""));
  if (!(advance > 0)) return { error: "The advance needs to be a dollar amount above 0." };
  if (advance > LIMITS.advance) return { error: "That advance looks too big. Check the digits." };
  const cutRaw = pick("cut", DEFAULT_CUT);
  const cut = cutRaw === "" || cutRaw == null ? DEFAULT_CUT : num(cutRaw);
  if (!(cut >= 0 && cut < 1)) return { error: "Defied's cut needs to be from 0% up to (not including) 100%." };
  const note = str(pick("note", ""), 600).trim();
  if (note.length > 500) return { error: "The note can be 500 characters at most." };
  const status = has("status") ? String(b.status) : base ? base.status : "planned";
  if (status !== "planned" && status !== "given") return { error: "A deal is planned or given." };
  let givenOn = null;
  if (status === "given") {
    givenOn = has("givenOn") && b.givenOn ? String(b.givenOn) : base?.givenOn || today;
    if (!validYmd(givenOn)) return { error: "Give the date it was given, like 2026-11-20." };
    if (givenOn < DEAL.effective) return { error: `A deal paid out of EMPIRE's advance can't be given before ${DEAL.effective}.` };
    if (givenOn > addDays(today, 1)) return { error: "The given date can't be in the future." };
  }
  return { value: { clientId: clientId || null, prospectName: clientId ? "" : linked, scope, placementIds, advance: cents(advance), cut: Math.round(cut * 10000) / 10000, status, givenOn, note } };
}

// a deal's status alone: planned, or given on a day (today unless typed). base: the deal as it is now. -> { value: { status, givenOn } }
export function checkDealStatus(b, { today, base }) {
  const status = String(b?.status ?? "");
  if (status !== "planned" && status !== "given") return { error: "A deal is planned or given." };
  if (status === "planned") return { value: { status, givenOn: null } };
  const givenOn = b?.givenOn ? String(b.givenOn) : base?.givenOn || today;
  if (!validYmd(givenOn)) return { error: "Give the date it was given, like 2026-11-20." };
  if (givenOn < DEAL.effective) return { error: `A deal paid out of EMPIRE's advance can't be given before ${DEAL.effective}.` };
  if (givenOn > addDays(today, 1)) return { error: "The given date can't be in the future." };
  return { value: { status, givenOn } };
}

// whether the pot (EMPIRE's execution advance) has arrived: { on, at }
export function checkReceived(b, { today }) {
  const on = b?.on === true || b?.on === "true";
  if (!on && !(b?.on === false || b?.on === "false")) return { error: "Say whether it has arrived (yes or no)." };
  if (!on) return { value: { on: false, at: null } };
  const at = b?.at ? String(b.at) : today;
  if (!validYmd(at)) return { error: "Give the day it arrived, like 2026-11-20." };
  if (at > addDays(today, 1)) return { error: "The day it arrived can't be in the future." };
  if (at < "2026-01-01") return { error: "That day is too far back." };
  return { value: { on: true, at } };
}

// the share of whole-song publishing counted as Net Income: a fraction in range, or blank/null to go back to the standard
export function checkLevers(b) {
  const v = b?.niShare;
  if (v === null || v === "" || v === undefined) return { value: { niShare: null } };
  const n = num(v);
  if (!(n >= NI_SHARE_RANGE[0] && n <= NI_SHARE_RANGE[1])) return { error: `That share needs to be between ${Math.round(NI_SHARE_RANGE[0] * 100)}% and ${Math.round(NI_SHARE_RANGE[1] * 100)}%.` };
  return { value: { niShare: Math.round(n * 10000) / 10000 } };
}
