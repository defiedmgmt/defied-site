// A&R's addresses (r10), on their own so the app shell can rewrite an old A&R address without loading A&R itself.
// The old sub-pages and To do's "watch:open:<key>" open their new place:
//   summary -> Home (/dashboard/ar) · watchlist -> watch · watch:open:<key> -> item/<key> · watch:flash:<key> -> watch
// r10 fix (N7, Team folded into the Watchlist): team / trackers / tracker -> watch, team/<userId> -> watch/by/<userId>
//   (the Watchlist filtered to that person), my -> mine (My A&R)
// r11 (the owner: Outreach and Sounds are gone): outreach and board -> watch; sounds and radar -> watch/sounds (the
//   Watchlist's TikTok sounds)
export const arSecOf = (sub) => {
  const s = String(sub || "");
  const m = /^watch:(open|flash):(.+)$/.exec(s);
  if (m) return m[1] === "open" ? `item/${m[2]}` : "watch";
  const [a, b, ...rest] = s.split("/");
  if (a === "team" || a === "trackers" || a === "tracker") return b ? `watch/by/${[b, ...rest].join("/")}` : "watch";
  if (a === "outreach" || a === "board") return "watch";
  if (a === "sounds" || a === "radar") return "watch/sounds";
  const old = { summary: "", watchlist: "watch", my: "mine" };
  return a in old ? [old[a], b, ...rest].filter((x) => x != null && x !== "").join("/") : s;
};
