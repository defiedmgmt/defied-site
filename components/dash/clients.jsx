import { useState, useEffect, useRef } from "react";
import { Trash2, Check, ChevronDown } from "lucide-react";
import LinkBox from "../LinkBox";
import { useEscape } from "./ui";
import { ownSplit, sameName } from "../site/data";

// A client's shared controls: delete (with what it takes along), the name check, the Spotify fill and the
// portal's "More" menu. Used by Site's roster, Publishing and the client portal (list B #11: their own module,
// so Publishing and the portal don't load Site's code).

// Shared by ClientsAdmin (Website -> Roster) and CatalogAdmin (Clients tab) —
// deleting a client removes them and every one of their songs locally, then
// clears each song's row off the pub sheet (only this client's own row —
// never a co-writer's) and finally releases the client's own tab back into
// the generic WRITER pool. Returns a warning string on partial failure, or
// null if everything cleared cleanly.
// the client header's More ▾: Delete client lives here, away from the chips you click all day
export function ClientMore({ onDelete }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="client-more" ref={box}>
      <button className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>More <ChevronDown size={14} /></button>
      {open && (
        <div className="client-more-menu" role="menu">
          <button role="menuitem" data-del-client onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} /> Delete client</button>
        </div>
      )}
    </div>
  );
}
// Delete client: what goes with them, and their name typed to confirm (both Publishing and Website › Roster)
export function clientDeleteAsk(db, c) {
  const n = db.placements.filter((p) => p.clientId === c.id).length;
  const hasLogin = db.users.some((u) => u.clientId === c.id);
  const tab = c.sheetTabName?.trim() || c.name;
  return {
    title: `Delete ${c.name}?`, goLabel: "Delete client", typeName: c.name,
    body: `${n ? `Deletes ${c.name}'s ${n} song${n === 1 ? "" : "s"} and clears their rows on the ${tab} tab.` : `${c.name} has no songs.`}${c.onRoster ? " Takes them off the public roster." : ""}${hasLogin ? " Removes their login." : ""} This can't be undone. Type ${c.name} to confirm.`,
  };
}
export async function deleteClientCascade(db, commit, id) {
  const client = db.clients.find((c) => c.id === id);
  const clientPlacements = db.placements.filter((p) => p.clientId === id);
  // a login account left pointing at a deleted client is a real login that
  // just 404s on their own data forever instead of being cleaned up — same
  // class of gap as data the UI hides but the API still allows; remove it
  // here instead of leaving stale valid credentials with nothing behind them.
  const saved = await commit({
    ...db,
    clients: db.clients.filter((c) => c.id !== id),
    placements: db.placements.filter((p) => p.clientId !== id),
    users: db.users.filter((u) => u.clientId !== id),
  }, db);
  // still on the site: their sheet rows and tab must stay too (the banner says why it failed)
  if (!saved) return null;

  const results = await Promise.allSettled(
    clientPlacements
      .filter((p) => ownSplit(p, client))
      .map(async (p) => {
        const splits = [{ name: client?.sheetTabName || client?.name }];
        const res = await fetch("/api/sheets-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
          body: JSON.stringify({ placementId: p.id, splits }),
        });
        if (!res.ok) throw new Error(p.song);
      })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) {
    return `Deleted locally, but ${failed} of ${clientPlacements.length} song row${clientPlacements.length === 1 ? "" : "s"} couldn't be cleared from the pub sheet. Check it manually if needed.`;
  }

  try {
    const tabName = client?.sheetTabName || client?.name;
    if (tabName) {
      const res = await fetch("/api/sheets-release-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ tabName }),
      });
      if (!res.ok) throw new Error();
    }
  } catch {
    return `Deleted and cleared their songs, but couldn't reset their tab on the pub sheet. It'll just sit empty under their old name — harmless, but you can rename it back to a WRITER slot by hand if you'd like.`;
  }
  return null;
}

// another client already going by `value` as their name or sheet tab: the two would share one tab on
// the pub sheet (or one would never find theirs). By personKey, so Stackie is Stack!e's but Stacke is free
export const NAME_TAKEN = "Another client already uses that name or sheet tab.";
export const nameTaken = (clients, id, value) => !!String(value || "").trim()
  && clients.some((o) => o.id !== id && [o.name, o.sheetTabName].some((s) => String(s || "").trim() && sameName(s, value)));

// The song forms' "paste a link" box (list B #7: components/LinkBox.jsx, POST /api/resolve-link): a
// Spotify song link fills in the title, artist, cover and release date, and says when the song is
// already on someone's page (co-writers share songs, so it can still be filled in)
export function SpotifyFill({ e, set }) {
  const [done, setDone] = useState(false);
  const fill = (r) => {
    const c = r.card || {};
    // onto the form as it is now, so anything typed during the lookup stays
    set((cur) => ({
      ...cur,
      song: c.name || cur.song,
      artist: c.artist || cur.artist,
      releaseDate: cur.releaseDate || c.releaseDate || "",
      cover: c.image || cur.cover,
      link: r.link?.url || cur.link,
    }));
    setDone(true);
  };
  return (
    <div className="sp-fill" data-sp-fill>
      <span className="fld-label">Paste the song's Spotify link to fill this in</span>
      <LinkBox context="roster" kinds={["song"]} addLabel="Fill in" allowDuplicate onAdd={fill} />
      {done && <span className="sp-note ok"><Check size={12} /> Filled in. Review the fields below.</span>}
    </div>
  );
}
