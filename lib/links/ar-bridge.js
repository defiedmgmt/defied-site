// The A&R functions the paste box and the digests use (lib/ar/trackers.js, radar.js, momentum.js: real DB
// data). Tests can hand in their own through useArForTests (tests/paste/fake-ar.mjs only, never app code).
import * as trackers from "../ar/trackers";
import * as radar from "../ar/radar";
import * as momentum from "../ar/momentum";

let over = {};
export const useArForTests = (o) => { over = o || {}; };
export const arFns = () => ({
  findTracked: over.findTracked ?? trackers.findTracked,
  findRemoved: over.findRemoved ?? trackers.findRemoved,
  listTracker: over.listTracker ?? trackers.listTracker,
  expiringSoon: over.expiringSoon ?? trackers.expiringSoon,
  topRisingSounds: over.topRisingSounds ?? radar.topRisingSounds,
  topMomentum: over.topMomentum ?? momentum.topMomentum,
});
