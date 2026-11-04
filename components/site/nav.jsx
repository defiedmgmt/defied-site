import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { Instagram } from "lucide-react";
import { ROUTE_TO_PATH } from "../shared/routes";
import { ExtLink, TLink, vtWillRun } from "../shared/ui";
import { PUBLIC_LINKS, XIcon } from "./data";

/* ------------------------------------------------------------------ */
/*  PUBLIC NAV + POSTER MENU + FOOTER                                   */
/* ------------------------------------------------------------------ */
export function PublicNav({ route, menuOpen, setMenuOpen, session }) {
  const authRoute = session ? (session.role === "staff" ? "staff" : "client") : "login";
  const [scrolled, setScrolled] = useState(false);
  const burgerRef = useRef(null);
  const router = useRouter();
  // with a view transition the menu leaves inside it; otherwise App closes it once the new
  // page is in. A tap on the page you're already on doesn't navigate, so that closes at once.
  const closeMenu = (e) => {
    if (vtWillRun() || e?.currentTarget?.getAttribute("href") === router.asPath) setMenuOpen(false);
  };

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // the menu is a modal sheet while open: lock the page behind it, Esc closes,
  // and focus goes back to the burger so keyboard users aren't stranded.
  useEffect(() => {
    if (!menuOpen) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      burgerRef.current?.focus({ preventScroll: true });
    };
  }, [menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // the sheet and burger only exist under 900px — rotating an iPad (or
  // widening the window) past that with the menu open must not leave the
  // page scroll-locked behind a menu that's no longer there
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = (e) => { if (e.matches) setMenuOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className={`nav2${scrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}>
        <TLink
          href={ROUTE_TO_PATH.home}
          vt="page-brand"
          className="nav2-mark"
          onClick={closeMenu}
          aria-label="Defied Management — home"
          style={{ viewTransitionName: route !== "home" ? "brand" : "nav-d" }}
        >
          <img src="/brand/d.png" alt="" width="45" height="36" draggable={false} />
          <span className="nav2-mark-shine" aria-hidden="true" />
        </TLink>
        <nav className="nav2-links" aria-label="Main">
          {PUBLIC_LINKS.map(([r, label]) => (
            <TLink key={r} href={ROUTE_TO_PATH[r]} className={route === r ? "active" : ""} aria-current={route === r ? "page" : undefined}>
              {label}
              {route === r && <i className="nav2-ind" style={{ viewTransitionName: "nav-ind" }} aria-hidden="true" />}
            </TLink>
          ))}
          <TLink href={ROUTE_TO_PATH[authRoute]} className="nav2-auth" {...(route === authRoute ? { "aria-current": "page" } : {})}>{session ? "Dashboard" : "Sign in"}</TLink>
        </nav>
        <button
          ref={burgerRef}
          className={`burger${menuOpen ? " x" : ""}`}
          onClick={() => setMenuOpen((m) => !m)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="poster-menu"
        >
          <i /><i />
        </button>
      </header>

      <div
        id="poster-menu"
        className={`pm${menuOpen ? " open" : ""}`}
        role="dialog"
        aria-label="Menu"
        aria-hidden={!menuOpen}
        {...(!menuOpen ? { inert: "" } : {})}
      >
        <img className="pm-d" src="/brand/d.png" alt="" aria-hidden="true" draggable={false} />
        <ol className="pm-list">
          {PUBLIC_LINKS.map(([r, label], i) => (
            <li className="pm-line" key={r} style={{ "--i": i }}>
              <TLink href={ROUTE_TO_PATH[r]} onClick={closeMenu} aria-current={route === r ? "page" : undefined} className={route === r ? "on" : ""}>
                <span className="pm-idx" aria-hidden="true">0{i + 1}</span>
                <span className="pm-word">{label}</span>
              </TLink>
            </li>
          ))}
        </ol>
        <div className="pm-foot">
          <TLink href={ROUTE_TO_PATH[authRoute]} onClick={closeMenu} className="pill pill-ghost" {...(route === authRoute ? { "aria-current": "page" } : {})}>{session ? "Dashboard" : "Sign in"}</TLink>
          <div className="pm-social">
            <ExtLink href="https://instagram.com/defiedmgmt" label="Instagram" className="hit"><Instagram size={20} /></ExtLink>
            <ExtLink href="https://x.com/defiedmgmt" label="X" className="hit"><XIcon size={18} /></ExtLink>
          </div>
        </div>
      </div>
    </>
  );
}

export function Footer({ route, inert }) {
  // One quiet sign-off, the same on every page: the D (home), the copyright, Contact and the socials.
  // It mirrors the nav bar — mark on the left, links on the right — so the page opens and closes on
  // one line. (Signing in stays in the nav.)
  return (
    <footer className="foot2" {...(inert ? { inert: "" } : {})}>
      <div className="ft">
        <TLink href={ROUTE_TO_PATH.home} className="ft-mark" aria-label="Defied Management — home">
          <img src="/brand/d.png" alt="" width="45" height="36" loading="lazy" decoding="async" draggable={false} />
          <span className="ft-mark-shine" aria-hidden="true" />
        </TLink>
        <p className="ft-copy">© {new Date().getFullYear()} Defied Management</p>
        <nav className="ft-links" aria-label="Footer">
          <TLink href={ROUTE_TO_PATH.contact} {...(route === "contact" ? { "aria-current": "page" } : {})}>Contact</TLink>
        </nav>
        <div className="ft-social">
          <ExtLink href="https://instagram.com/defiedmgmt" className="ft-soc" label="Instagram, @defiedmgmt"><Instagram size={17} /></ExtLink>
          <ExtLink href="https://x.com/defiedmgmt" className="ft-soc" label="X, @defiedmgmt"><XIcon size={15} /></ExtLink>
        </div>
      </div>
    </footer>
  );
}
