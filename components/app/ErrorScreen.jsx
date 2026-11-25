import React from "react";

// (2026-11-25, mobile) When a page breaks: the site's own screen with a way back in, never Next's white "Application error" page.
// An installed iPhone app has no reload button and no pull-to-refresh, so "Try again" reloads the page. Styles: styles/m-global.css (.err-screen).
// Used by pages/_error.jsx (a server error, or a crash outside the boundary below) and by AppErrorBoundary.
export function ErrorScreen({ code = null, title = "Something went wrong.", text = "This page hit a problem. Try again, and if it keeps happening, let us know." }) {
  return (
    <main className="err-screen" role="alert" data-error-screen>
      <img src="/brand/wordmark.webp" alt="Defied Management" className="logo-wordmark" width="200" height="40" draggable={false} />
      {code ? <p className="micro-label err-code">Error {code}</p> : null}
      <h1>{title}</h1>
      <p>{text}</p>
      <div className="err-acts">
        <button type="button" className="pill pill-solid" onClick={() => window.location.reload()} data-error-retry>Try again</button>
      </div>
    </main>
  );
}

// The dashboard's and the portal's safety net (components/app/AppRoot.jsx wraps their page in it): a section that throws while it
// draws shows the screen above instead of taking the whole app down. Moving to another address (resetKey) draws the page again.
export class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
  render() { return this.state.failed ? <ErrorScreen /> : this.props.children; }
}
