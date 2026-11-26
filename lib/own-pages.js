// Which staff logins have a page of their own: "My to-do" (their ClickUp MGMT list) and "My payments" (their pay link), by the FIRST word of
// the login's name ("Magnus Hale" -> Magnus -> Mag). The page comes with the name, not with a section: To do and Money are the whole team's
// and all of Defied's books, these two are the login's own. Pure (no imports but names.js, nothing from the environment, nothing secret), so
// the server (lib/clickup-tasks.js mgmtListOf) and the browser (Site › Users' "Their own" lines, components/dash/admin.jsx) ask the same
// table the same question. (2026-11-26, paylinks-1126) My payments follows the pay links setting now: lib/pay-links.js hasMyPay(name, links).
import { personKey } from "./names";

// a first name -> the key of that person's MGMT list (lib/clickup-tasks.js LISTS)
const MGMT_OF = { devin: "devin", ella: "ella", hank: "hank", mag: "mag", magnus: "mag", jordan: "jordan" };
const firstKey = (name) => personKey(String(name ?? "").trim().split(/\s+/)[0]);

// the key of the MGMT list for a name's first word; null when there is none
export const mgmtKeyOf = (name) => MGMT_OF[firstKey(name)] || null;

// does a login with this name get My to-do?
export const hasMyTodo = (name) => !!mgmtKeyOf(name);
