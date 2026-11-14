// The day the pub sheet's streams are from, as the pages say "streams as of" (moved here from pages/api/dashboard-data.js
// on 2026-11-13, so the share card says the same day as the client's portal: lib/share-card.js). Server-only.
// STREAM DATA's writer's last update when it's on (lib/stream-sheet.js), else Luminate's last numbers for the clients'
// songs (the pub sheet's STREAM DATA tab isn't updated since list B #3), so a page says that day, not the pull's.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getState } from "./app-state";
import { streamSheetOn, streamSheetMonthly } from "./stream-sheet";

export const nyYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

// "YYYY-MM-DD", or null
export const streamsOn = async () => {
  if (streamSheetOn()) { const st = await getState("streamSheet").catch(() => null); if (st?.at) return nyYmd(st.at); }
  // monthly (2026-11-10): the newest applied Luminate report's day, once the sheet has been given one
  if (streamSheetMonthly() && (await getState("streamSheet").catch(() => null))?.at) {
    const [r] = await rowsOrNoneIfNoTable(sql`SELECT max(total_on)::text AS day FROM trueup_points`);
    if (r?.day) return String(r.day).slice(0, 10);
  }
  return rowsOrNoneIfNoTable(sql`SELECT max(atd_on)::text AS day FROM lum_history WHERE area = 'roster'`).then((r) => (r[0]?.day ? String(r[0].day).slice(0, 10) : null));
};
