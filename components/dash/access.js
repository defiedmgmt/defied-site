// Who may use which dashboard section, and To do's areas: the shell, Site › Users and To do share these
// (list B #11: a leaf module, so none of them pulls in another section).
// Roles (lib/roles.js): may this account use that section? The server says which in db.access (and
// enforces it on every request); with no db.access (a client's portal) nothing here applies.
export const canUse = (db, k) => !db?.access || db.access.sections.includes(k);
export const TODO_AREAS = ["money", "roster", "ar", "clickup", "site"];
