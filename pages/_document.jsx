import { Html, Head, Main, NextScript } from "next/document";
import { RESUME_SCRIPT } from "../components/app/resume";

// Here to set the page language (screen readers pick their voice from it); everything else in <head> comes from PageShell.
// (2026-11-25, mobile) and the one script that runs before anything is drawn: the installed app's launch page shows a neutral
// Defied screen instead of the sign-in form to someone already signed in on this device (components/app/resume.js).
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <script dangerouslySetInnerHTML={{ __html: RESUME_SCRIPT }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
