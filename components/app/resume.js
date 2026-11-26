import { useEffect, useRef } from "react";

// (2026-11-25, mobile) The installed app opens on /login (public/manifest.webmanifest's start_url). Someone already signed in on this
// device used to see the public sign-in form for a moment on every launch, until the session check answered and sent them on: it read
// as "I got signed out". Now the page starts as a neutral Defied screen while it checks, for anyone this device has seen signed in.
//   SIGNED_IN_HINT: a note in this browser's storage that an account is signed in here (never who). components/app/AppRoot.jsx writes
//     it when the check says signed in, and removes it when it says signed out (a failed check leaves it as it was).
//   RESUME_SCRIPT: runs in pages/_document.jsx's <body> before anything is drawn: on the sign-in page with that note, <html data-resume>
//     (styles/m-global.css draws the screen over everything). AppRoot takes it off once there's something to show: the sign-in form
//     (signed out, or the check failed) or the dashboard or portal with its data. It never stays more than 8 seconds.
// Signed-out visitors never have the note, so they get the sign-in form straight away, as before.
export const SIGNED_IN_HINT = "defied-signed-in";
export const RESUME_MAX_MS = 8000;
export const RESUME_SCRIPT = `try{if(/^\\/login\\/?$/.test(location.pathname)&&localStorage.getItem(${JSON.stringify(SIGNED_IN_HINT)})){var d=document.documentElement;d.setAttribute("data-resume","");setTimeout(function(){d.removeAttribute("data-resume")},${RESUME_MAX_MS})}}catch(e){}`;
// the client portal reads its data again when the app comes back after this long away (AppRoot)
export const RESUME_REFRESH_MS = 5 * 60 * 1000;

// (2026-11-26 review) Coming back after RESUME_REFRESH_MS or more away (AppRoot, never mid-save or under an open window) tells the screens on show:
// each read-only loader that registered with useOnResume reads again (the portal's numbers and commission; the staff dashboard's counts, ClickUp,
// the sync checks, the song facts, Home's and Money's numbers). Their own reads go through readFresh / swrJson as on a tab switch, so a write on
// its way is still waited for. Nothing that holds an edit is reloaded.
const resumeSubs = new Set();
export function emitResume() {
  for (const fn of [...resumeSubs]) { try { fn(); } catch (err) { console.error("A refresh on coming back failed:", err); } }
}
// fn: called on each such return while the component is mounted (the latest fn, so it sees the latest props)
export function useOnResume(fn) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const run = () => latest.current?.();
    resumeSubs.add(run);
    return () => { resumeSubs.delete(run); };
  }, []);
}

// (2026-11-26 review) Where sign-in goes on to: a link into a section (ClickUp's tasks, the weekly digest) sends a signed-out person to
// /login?next=<that address> (AppRoot's route guard). search: the sign-in page's location.search. Only an address of this role's own app is
// used (/dashboard… for staff, /portal… for a client), never another site's (no "//", no "://", no backslash); anything else -> null (the role's home).
export function nextAfterSignIn(search, role) {
  let next = null;
  try { next = new URLSearchParams(String(search || "")).get("next"); } catch { return null; }
  const home = role === "staff" ? "/dashboard" : role === "client" ? "/portal" : null;
  if (!home || typeof next !== "string" || next.length > 512) return null;
  if (!(next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`) || next.startsWith(`${home}#`))) return null;
  if (next.startsWith("//") || next.includes("://") || /[\\\s]/.test(next)) return null;
  return next;
}
