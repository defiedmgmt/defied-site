

// every internal route name maps to a real, bookmarkable URL — each has its
// own page file (pages/about.jsx etc.) that draws that page inside the app
// shell (components/app/AppRoot.jsx); the route itself is derived from the
// current URL, not kept as separate React state.
export const ROUTE_TO_PATH = {
  home: "/", about: "/about", team: "/team", roster: "/roster",
  contact: "/contact", login: "/login", staff: "/dashboard", client: "/portal",
};
export const PATH_TO_ROUTE = Object.fromEntries(Object.entries(ROUTE_TO_PATH).map(([k, v]) => [v, k]));
// the route a page file's pathname is: every dashboard section's address (/dashboard/<section>, one
// page file, pages/dashboard/[[...section]].jsx) is the staff dashboard; pages/404 renders for any unknown
// URL; everything else unknown still falls back to Home
export const routeOf = (pathname) => PATH_TO_ROUTE[pathname] || (/^\/dashboard(\/|$)/.test(pathname) ? "staff" : pathname === "/404" ? "notfound" : "home");
