// (2026-11-25) The day Luminate's exports changed how they count, in one place for the server (lib/data/lum.js and the forecast that reads the totals) and the pages that draw Luminate's history.
// The portfolio exports of Aug 13-27 (the older column layout) carry a NARROWER all-time count, and narrower weeks, than every export from Sep 8, 2026 on (about 16M
// streams apart on one big song): a total or a week from before this day is on the older count and is never compared with one from it on. Pure, no imports: it is
// a fact about Luminate's files, not a term of any deal, so the page's code may carry it.
export const LUM_BASIS_FROM = "2026-09-08";
// the note shown wherever older numbers are kept apart
export const LUM_BASIS_NOTE = "Luminate changed how it counts on Sep 8, 2026";
// a point on the older count: one whose last day (`to`, the export day for an all-time total) is before LUM_BASIS_FROM
export const olderCount = (day) => !!day && String(day).slice(0, 10) < LUM_BASIS_FROM;
