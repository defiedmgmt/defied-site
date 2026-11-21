// (2026-11-21) The EMPIRE page's two calls to /api/empire (Money access only): the one read, kept for the tab like the dashboard's other reads (components/ui/fetch-cache.js:
// shown at once from the last answer, read again behind it, emptied by any save), and a save that answers in words. Shared by empire.jsx and empire-calc.jsx.
import { useState, useEffect } from "react";
import { swrJson, peekJson } from "../ui/fetch-cache";

const ENDPOINT = "/api/empire";

export async function empirePost(body) {
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw Object.assign(new Error(data.error || "That didn't go through. Check your connection and try again."), { status: res?.status });
  return data;
}

export function useEmpire() {
  const [data, setData] = useState(() => peekJson(ENDPOINT) || null);
  const [err, setErr] = useState(null);
  const load = () => swrJson(ENDPOINT, (d) => { setData(d); setErr(null); }, { anyStatus: true })
    .then((d) => { if (d?.error) throw new Error(d.error); })
    .catch((e) => setErr(e.message || "Couldn't load the EMPIRE numbers."));
  const retry = () => { setErr(null); load(); };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, load, retry };
}

// One save at a time on a panel: busy while it runs, the error in words, and the page's data read again after it
export function useAct(reload) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const act = async (body, after) => {
    setBusy(true); setErr(null);
    try { const out = await empirePost(body); await reload(); after?.(out); return out; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  return { busy, err, act, clear: () => setErr(null) };
}
