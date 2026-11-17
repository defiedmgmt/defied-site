// The songs lib/auto-add.js put on the site by themselves that nobody has said OK to yet. app_state "autoAdded" is
// { [Spotify track id]: { placementId, clientId, at, checked? } }; "OK" on To do's list sets checked: true. Pure: GET /api/songs
// (lib/song-info.js), To do's list (components/dash/helpers.jsx autoAddedOf) and Publishing's ClickUp count (lib/area-tasks.js)
// all read this one rule, so the three can't disagree.

// the entries still waiting for an OK: [{ id (the Spotify track id), placementId, clientId, at }], the oldest added first
export function uncheckedAutoAdds(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  return Object.entries(state)
    .filter(([, e]) => e && typeof e === "object" && e.checked !== true && e.placementId)
    .map(([id, e]) => ({ id, placementId: String(e.placementId), clientId: String(e.clientId || ""), at: String(e.at || "") }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

// ...and whose song is still on the site: a song deleted since needs no check. placements: anything with an id
export function stillOnSite(list, placements) {
  const ids = new Set((placements || []).map((p) => p.id));
  return (list || []).filter((x) => ids.has(x.placementId));
}
