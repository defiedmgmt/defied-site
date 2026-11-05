// A&R's Board stages and their pill, also drawn on Home's This week (list B #11: a leaf module, so Home
// doesn't load A&R's code for one pill).
// The Board's stages in plain words. A producer's stage is its sheet status (OUTREACH_STATUSES are
// what's saved); a tracked artist's is saved in the database only (ar_tracked.stage).
export const AR_STAGES = [
  { id: "reach", label: "To reach out", hint: "Haven't messaged yet", verb: null, status: "Not Contacted" },
  { id: "reached", label: "Reached out", hint: "Waiting to hear back", verb: "Reached out →", status: "Contacted" },
  { id: "talking", label: "Talking", hint: "Going back and forth", verb: "Started talking →", status: "In Talks" },
  { id: "offer", label: "Offer sent", hint: "Waiting on their answer", verb: "Sent an offer →", status: "Offer Out" },
  { id: "signed", label: "Signed", hint: "Done deals", verb: "Signed ✓", status: "Signed" },
];
export const stageLabel = (id) => AR_STAGES.find((s) => s.id === id)?.label || (id === "passed" ? "Passed" : id === "other" ? "Other" : "Just watching");
// one coloured pill per stage (the colour comes from data-stage), the same on every A&R page
export const StagePill = ({ id, n, label }) => <span className="ar-stage" data-stage={id}>{label || stageLabel(id)}{n != null && <b>{n}</b>}</span>;
