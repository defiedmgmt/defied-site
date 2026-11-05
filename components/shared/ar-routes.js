// A&R's addresses (r10), on their own so the app shell can rewrite an old A&R address without loading A&R itself.
// The old sub-pages and To do's "watch:open:<key>" open their new place:
//   summary -> Home (/dashboard/ar) · trackers / tracker -> team · radar -> sounds · board -> outreach
//   watchlist -> watch · watch:open:<key> -> item/<key> · watch:flash:<key> -> watch
export const arSecOf = (sub) => {
  const s = String(sub || "");
  const m = /^watch:(open|flash):(.+)$/.exec(s);
  if (m) return m[1] === "open" ? `item/${m[2]}` : "watch";
  const old = { summary: "", trackers: "team", tracker: "team", radar: "sounds", board: "outreach", watchlist: "watch" };
  return s in old ? old[s] : s;
};
