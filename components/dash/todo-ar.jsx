import { useState } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { ArPanels, arCards, followChip, useArAll } from "./ar";

// A&R follow-ups due today or late: each person, and Open shows their panel right here
export function ArFollowUps({ ctx }) {
  const ar = useArAll();
  const { cards } = arCards(ar.data, ar.pg);
  const [open, setOpen] = useState(null);
  const due = cards.filter((c) => c.stage !== "passed" && c.stage !== "signed" && (c.followUp?.state === "overdue" || c.followUp?.state === "due"));
  return (
    <div className="todo-sublist">
      {!ar.pg ? <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>
        : !due.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> No follow-ups due.</p>
        : due.map((c) => (
          <div key={c.key} className="fix-row" data-follow={c.id}>
            <span className="fix-song">{c.name}</span>
            <span className="fix-mid">{followChip(c.followUp)}</span>
            <span className="fix-acts"><button className="btn sm" onClick={() => setOpen(c.key.startsWith("p:") ? { type: "prospect", id: c.id } : { type: "tracked", id: c.id })}>Open</button></span>
          </div>
        ))}
      <ArPanels ar={ar} open={open} openPanel={setOpen} closePanel={() => setOpen(null)} onGo={ctx.onGo} />
    </div>
  );
}
