// The A&R builder's functions (the shared contract: lib/ar/trackers.js, radar.js, momentum.js), when
// they're in this build. The paste box and the digests are built on a branch where they aren't yet, so
// each is looked up here and is null when missing: the box then says nothing about A&R trackers, and
// the digest's A&R sections say "Starts when the A&R tracker lands" (never made-up rows).
// MERGE NOTE: once lib/ar/* is on the same branch, these can become plain imports.
// (webpack: a require() inside try is optional, so a missing file is a build warning, not an error.)
let trackers = null, radar = null, momentum = null;
try { trackers = require("../ar/trackers"); } catch { trackers = null; }
try { radar = require("../ar/radar"); } catch { radar = null; }
try { momentum = require("../ar/momentum"); } catch { momentum = null; }

const fn = (mod, name) => (mod && typeof mod[name] === "function" ? mod[name] : null);
// tests replace these (tests/paste/*: a fake A&R module, never app code)
let over = {};
export const useArForTests = (o) => { over = o || {}; };
export const arFns = () => ({
  findTracked: over.findTracked ?? fn(trackers, "findTracked"),
  listTracker: over.listTracker ?? fn(trackers, "listTracker"),
  expiringSoon: over.expiringSoon ?? fn(trackers, "expiringSoon"),
  topRisingSounds: over.topRisingSounds ?? fn(radar, "topRisingSounds"),
  topMomentum: over.topMomentum ?? fn(momentum, "topMomentum"),
});
