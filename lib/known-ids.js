// (2026-11-18) The rule for a table the page sends whole (the songs, the notable releases): a save never deletes or overwrites a row its page
// didn't know about. The page says which rows its copy had (body.knownIds[table]: the ids of what it got from the server, never of the list it
// edited), so a row added since (the nightly auto-add, the sheet sync, another person) isn't in that list and is left alone: only a row the page
// knew and left out is deleted (the person removed it), and only a row that is new or differs from the stored one is written. A page from before
// this sends no knownIds: it knows nothing, so its rows are written and nothing is deleted (`stale`). Pure: no database in here.

// the ids body.knownIds says the page had of one table, as a Set; null when it said nothing (a page from before)
export const knownOf = (body, table) => {
  const ids = body?.knownIds?.[table];
  return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === "string")) : null;
};

// submitted: the rows the page sent (as they'd be stored), stored: the rows the table holds now (only those this account may change),
// same(a, b): whether two rows say the same -> { stale, known, sent, remove: the ids to delete, write: the rows to upsert }
export function planRows({ submitted, known, stored, same }) {
  const sent = new Map(submitted.map((r) => [r.id, r])), has = new Map(stored.map((r) => [r.id, r]));
  return {
    stale: !known,
    known,
    sent: new Set(sent.keys()),
    remove: known ? [...known].filter((id) => has.has(id) && !sent.has(id)) : [],
    write: [...sent.values()].filter((r) => !has.has(r.id) || !same(has.get(r.id), r)),
  };
}
