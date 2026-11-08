// One Income row as the Log confirm shows it, every field filled in the way the site worked it out and open to
// change (r11, the owner: "autofill but gimme the option to change"). The dialog (components/dash/money.jsx) and
// the server (lib/accounting-log.js) read these same checks, so a change the page lets through is one the server
// writes, and one it stops the server refuses too. Only a field that differs from the site's own value is checked:
// a row nobody touched goes in exactly as it did before.
// Pure, no imports: safe in the browser.

export const COMMISSION = "Management Commission";
export const GENERAL = "General / Company";
export const EDIT_FIELDS = ["day", "type", "client", "amount", "account", "notes", "manager", "managerShare"];
// the sheet's own column names, for a reason the server gives ("Gross Commission: …")
export const FIELD_LABEL = { day: "Date", type: "Revenue Type", client: "Artist / Client", amount: "Gross Commission", account: "Account", notes: "Source / Notes", manager: "Manager", managerShare: "Manager Share" };
const MAX_CENTS = 100000000; // $1,000,000: a typo guard, far above any payment so far
const NOTES_MAX = 200;
const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

// The date field's "YYYY-MM-DD" (or the sheet's M/D/YYYY), a real day in the sheet's year: { day } or { reason }
export function typedDay(v, year) {
  const t = str(v);
  if (!t) return { reason: "Pick a date." };
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t), y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [y, mo, d] = [+m[3], +m[1], +m[2]];
  else return { reason: "Pick a real date." };
  const at = new Date(Date.UTC(y, mo - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return { reason: "Pick a real date." };
  if (year && y !== Number(year)) return { reason: `The sheet is the ${year} book: pick a date in ${year}.` };
  return { day: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// A dollar amount ("9", "9.5", "$1,000.00", or a number): cents at most. More than $0 (Gross Commission), or $0 and
// up with zero (Manager Share). { cents } or { reason }
export function typedMoney(v, { zero = false } = {}) {
  let t = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "x") : str(v).replace(/^\$\s*/, "").replace(/^(-)\s*\$\s*/, "$1");
  if (!t) return { reason: zero ? "Type an amount, like 0.00." : "Type an amount." };
  if (/^-/.test(t)) return { reason: zero ? "It can't be less than $0." : "It has to be more than $0." };
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, "");
  if (/^\d*\.\d{3,}$/.test(t)) return { reason: "Cents at most, like 9.99." };
  if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(t)) return { reason: "Type an amount, like 9.00." };
  const [whole, frac = ""] = t.split(".");
  const cents = Number(whole || 0) * 100 + Number((frac + "00").slice(0, 2));
  if (!zero && !(cents > 0)) return { reason: "It has to be more than $0." };
  if (cents > MAX_CENTS) return { reason: "$1,000,000 at most." };
  return { cents };
}

// Source / Notes: one line, 200 characters at most
export function typedNotes(v) {
  const t = str(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ");
  if (t.length > NOTES_MAX) return { reason: `${NOTES_MAX} characters at most.` };
  return { notes: t };
}

// A co-manager's Manager Share on a General / Company row (lib/accounting-place.js coSplit): the gross less Defied's
// 33% (keep), in cents. It follows the amount until the owner types their own.
export const coShare = (cents, keep) => cents - Math.round(cents * keep);

// What the sheet works out on its own for a row (its E, G and H formulas): INFO's Assigned Manager for the client,
// the Manager Share at INFO's Manager Gets % (none without a manager), DEFIED SHARE the rest. Cents.
// roster: [{ name, manager, pct }] from INFO (C, E, F). MATCH(…, 0) ignores case, so this does too.
export function sheetSplit(client, cents, roster) {
  const key = str(client).toLowerCase();
  const r = key ? (roster || []).find((x) => str(x.name).toLowerCase() === key) : null;
  const manager = str(r?.manager);
  const share = manager ? Math.round(cents * (Number(r.pct) || 0)) : 0;
  return { manager, share, defied: cents - share };
}

// The row with the owner's changes over the site's own (base: the row as the dry run gave it; edit: what the dialog
// sends, every field it shows). opts: the sheet's lists ({ types, clients, accounts, managers }, the Income tab's
// data validation and INFO's managers). co: { via, keep } when a General / Company row for this payment has its
// Manager and Manager Share typed (a co-manager's link), else null: then the sheet's formulas decide them and
// they can't be sent. { row } with the values to write, or { problems: { field: reason } }.
export function checkEdit(edit, base, opts, { year, co = null } = {}) {
  const e = edit && typeof edit === "object" ? edit : {};
  const problems = {};
  const has = (k) => e[k] !== undefined && e[k] !== null;
  // a field the owner left as the site had it passes as it is (today's row); only a change is checked
  const pick = (k, same, check) => {
    if (!has(k) || same(e[k])) return base[k];
    const r = check(e[k]);
    if (r.reason) { problems[k] = r.reason; return base[k]; }
    return r.v;
  };
  const inList = (list, why) => (v) => (list || []).includes(str(v)) ? { v: str(v) } : { reason: why };
  const day = pick("day", (v) => typedDay(v, year).day === base.day, (v) => { const r = typedDay(v, year); return r.reason ? r : { v: r.day }; });
  const type = pick("type", (v) => str(v) === str(base.type), inList(opts?.types, "Pick a Revenue Type from the sheet's list."));
  const client = pick("client", (v) => str(v) === str(base.client), (v) => (!str(v) ? { v: "" } : inList(opts?.clients, "Pick an Artist / Client from INFO's list.")(v)));
  const baseCents = Math.round(Number(base.amount) * 100);
  const cents = Math.round(Number(pick("amount", (v) => typedMoney(v).cents === baseCents, (v) => { const r = typedMoney(v); return r.reason ? r : { v: r.cents / 100 }; })) * 100);
  const account = pick("account", (v) => str(v) === str(base.account), inList(opts?.accounts, "Pick an Account from the sheet's list."));
  const notes = pick("notes", (v) => typedNotes(v).notes === str(base.notes), (v) => { const r = typedNotes(v); return r.reason ? r : { v: r.notes }; });
  if (!client && type === COMMISSION && !problems.client && !problems.type) problems.client = "A Management Commission row needs an Artist / Client.";
  const row = { day, type, client, amount: cents / 100, account, notes };
  if (co && client === GENERAL) {
    // typed over the row's own formulas, like the owner's rows 4, 37 and 58
    // the site's own: the link's owner, and the share worked out from the amount (the dry run's, or the new one)
    const baseManager = str(base.manager) || co.via;
    const baseShare = base.manager && Math.round(Number(base.amount) * 100) === cents ? Math.round(Number(base.managerShare) * 100) : coShare(cents, co.keep);
    const mgr = !has("manager") || str(e.manager) === baseManager ? { v: baseManager } : inList(opts?.managers, "Pick a Manager from INFO's list.")(e.manager);
    if (mgr.reason) problems.manager = mgr.reason; else row.manager = mgr.v;
    const share = has("managerShare") ? typedMoney(e.managerShare, { zero: true }) : { cents: baseShare };
    if (share.reason) problems.managerShare = share.reason;
    else if (share.cents > cents && !problems.amount) problems.managerShare = "It can't be more than the Gross Commission.";
    else row.managerShare = share.cents / 100;
  } else if (has("manager") || has("managerShare")) {
    problems.manager = "The sheet works out the manager for this row.";
  }
  return Object.keys(problems).length ? { problems } : { row };
}
// "Gross Commission: It has to be more than $0. Date: …": a refused edit, said by the server
export const problemText = (problems) => Object.entries(problems).map(([k, why]) => `${FIELD_LABEL[k] || k}: ${why}`).join(" ");
