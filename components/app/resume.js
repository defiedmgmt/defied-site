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
