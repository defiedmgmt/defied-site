import { Html, Head, Main, NextScript } from "next/document";

// Only here to set the page language (screen readers pick their voice from it); everything else
// in <head> comes from PageShell.
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
