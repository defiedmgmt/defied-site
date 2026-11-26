// (2026-11-24, speed) GET /api/boot?u=<url>&u=<url>…: a dashboard page's first reads in one request, each answered by its own route's
// handler (lib/boot.js runs them in-process, with this request's cookie: every role check is that route's own). Only the URLs below;
// each old route still works on its own for every other caller (a reload after a save, Try again, ?fresh=1, the portal).
// One line of JSON per read as it's ready ({ u, s, ms, b }, or { u, f: 1 } for one that took too long); components/shared/boot.js reads them
// and hands each to the code that asked.
import { runBoot, partTable } from "../../lib/boot";
import me from "./auth/me";
import dashboardData from "./dashboard-data";
import songs from "./songs";
import splitFixes from "./split-fixes";
import data from "./data";
import trueup from "./trueup";
import ar from "./ar";
import arLists from "./ar-lists";
import accounting from "./accounting";
import tasks from "./tasks";
import sync from "./sync";
import home from "./home";
import growth from "./growth";
import sheetsPull from "./sheets-pull";
import paydays from "./paydays";

// the slowest of these (the first Stripe fill, the Sync checks) have 60 s on their own routes; streaming lets each line leave when ready
// (responseLimit: the lines are streamed; Next's 4 MB warning is for one buffered answer)
export const config = { maxDuration: 60, supportsResponseStreaming: true, api: { responseLimit: false } };

const PARTS = partTable([
  ["/api/auth/me", me],
  ["/api/dashboard-data", dashboardData],
  ["/api/songs", songs],
  ["/api/split-fixes", splitFixes],
  ["/api/data?seeds=1", data],
  ["/api/data?home=1", data],
  ["/api/trueup", trueup],
  ["/api/ar?summary=1", ar],
  ["/api/ar-lists?view=home", arLists],
  ["/api/accounting?counts=1", accounting],
  ["/api/accounting", accounting],
  ["/api/tasks", tasks],
  ["/api/sync", sync],
  ["/api/home", home],
  ["/api/growth?top=1", growth],
  // (2026-11-25) whether the Dashboard's background sheet pull is due (its GET is read only)
  ["/api/sheets-pull?due=1", sheetsPull],
  // (2026-11-26) Money › Paydays' own read
  ["/api/paydays", paydays],
]);

export default function handler(req, res) {
  return runBoot(req, res, PARTS);
}
