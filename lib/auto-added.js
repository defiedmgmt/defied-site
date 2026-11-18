// The songs lib/auto-add.js put on the site by themselves that nobody has said OK to yet. app_state "autoAdded" is
// { [Spotify track id]: { placementId, clientId, at, checked?, pending? } }; "OK" on To do's list sets checked: true. Pure: GET /api/songs
// (lib/song-info.js), To do's list (components/dash/helpers.jsx autoAddedOf) and Publishing's ClickUp count (lib/area-tasks.js)
// all read this one rule, so the three can't disagree.
// (2026-11-18) pending: true is a song that is on the site while its pub sheet row isn't written yet (the write was stopped: Google's quota, a refusal).
// It is not in the list to check, whose line says "already on the pub sheet", until the next run has written its row (Songs to update shows it as "Not on
// the pub sheet" meanwhile): pendingAutoAdds is what that run finishes first (lib/auto-add.js).

// the entries still waiting for an OK: [{ id (the Spotify track id), placementId, clientId, at }], the oldest added first. A pending one isn't there yet
export function uncheckedAutoAdds(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  return Object.entries(state)
    .filter(([, e]) => e && typeof e === "object" && e.checked !== true && e.pending !== true && e.placementId)
    .map(([id, e]) => ({ id, placementId: String(e.placementId), clientId: String(e.clientId || ""), at: String(e.at || "") }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

// the entries whose pub sheet row still has to be written: [{ key (the Spotify track id, or <id>:<client id>), placementId, clientId, at }], the oldest first
export function pendingAutoAdds(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  return Object.entries(state)
    .filter(([, e]) => e && typeof e === "object" && e.pending === true && e.placementId)
    .map(([key, e]) => ({ key, placementId: String(e.placementId), clientId: String(e.clientId || ""), at: String(e.at || "") }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

// ...and whose song is still on the site: a song deleted since needs no check. placements: anything with an id
export function stillOnSite(list, placements) {
  const ids = new Set((placements || []).map((p) => p.id));
  return (list || []).filter((x) => ids.has(x.placementId));
}
