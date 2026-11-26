import React from "react";

// (2026-11-25, mobile) When a page breaks: the site's own screen with a way back in, never Next's white "Application error" page.
// An installed iPhone app has no reload button and no pull-to-refresh, so "Try again" reloads the page. Styles: styles/m-global.css (.err-screen).
// Used by pages/_error.jsx (a server error, or a crash outside the boundary below) and by AppErrorBoundary.
// (2026-11-26 review) inline: the same screen inside the dashboard or the portal, under their own sidebar / header (no logo, not full height:
// styles/sections.css .err-inline). onRetry: what Try again does instead of reloading (the inline boundary draws the section again; the dataset
// screen reads the data again). onSignOut: a Sign out button beside it, for the screens that have no other way out (pages/dashboard, pages/portal).
export function ErrorScreen({ code = null, title = "Something went wrong.", text = "This page hit a problem. Try again, and if it keeps happening, let us know.", inline = false, onRetry = null, onSignOut = null, signingOut = false }) {
  const Box = inline ? "div" : "main";
  return (
    <Box className={inline ? "err-screen err-inline" : "err-screen"} role="alert" data-error-screen>
      {!inline && <img src="/brand/wordmark.webp" alt="Defied Management" className="logo-wordmark" width="200" height="40" draggable={false} />}
      {code ? <p className="micro-label err-code">Error {code}</p> : null}
      <h1>{title}</h1>
      <p>{text}</p>
      <div className="err-acts">
        {onRetry
          ? <button type="button" className="pill pill-solid" onClick={onRetry} data-error-retry>Try again</button>
          : <button type="button" className="pill pill-solid" onClick={() => window.location.reload()} data-error-retry>Try again</button>}
        {onSignOut && <button type="button" className="pill pill-ghost" onClick={onSignOut} disabled={signingOut} data-error-signout>{signingOut ? "Signing out…" : "Sign out"}</button>}
      </div>
    </Box>
  );
}

// The dashboard's and the portal's safety net: a part that throws while it draws shows the screen above instead of taking the whole app
// down. Moving to another address (resetKey) draws it again.
//   page level (pages/dashboard, pages/portal): the last resort, around the whole app; Try again reloads.
//   inline (2026-11-26 review: StaffDashboard around the section only, ClientPortal around its main column): the sidebar, the phone tab bar,
//   Password and Sign out stay usable, switching tabs resets it, and Try again draws the section again in place (no reload: the installed app
//   launches on /login, which goes to the Dashboard, so a reload of a section that can't draw used to lock the person out of every other one).
//   The section's own subtree was already unmounted while the screen showed, so drawing it again starts it fresh.
export class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; this.retry = () => this.setState({ failed: false }); }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
  render() { return this.state.failed ? (this.props.inline ? <ErrorScreen inline onRetry={this.retry} /> : <ErrorScreen />) : this.props.children; }
}
