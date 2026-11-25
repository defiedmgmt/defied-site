// (2026-11-25, mobile) What a phone is, for every phone switch in JS (components/ui/responsive.jsx re-exports these; components/ui/mobile.css
// mirrors them): under 640px wide, or a touch screen under 500px tall, i.e. a phone held sideways (844x390, 667x375), which used to get the
// desktop or tablet layout. A screen with a width of its own (A&R's cards at 699px, To do's week at 599px) keeps it: phoneQuery(699).
// (2026-11-25, final review RUX-1) The dashboard's and portal's shell (top bar and bottom tab bar, styles/app.css and the m-*.css phone blocks) switches in CSS on
// (max-width:899px) plus this same PHONE_SIDEWAYS clause, and its desktop-only rules (min-width:900px) leave a short touch screen out: with viewport-fit=cover an
// iPhone Plus / Pro Max held sideways is 926-956px wide, and it gets the phone shell, not the desktop side nav. iPads and desktops (taller than 500px, or a mouse)
// keep theirs. No JS picks the shell; every phone switch in JS is PHONE_Q or phoneQuery(n).
export const PHONE_MAX = 639;
export const PHONE_SIDEWAYS = "(pointer:coarse) and (max-height:500px)";
export const phoneQuery = (maxWidth = PHONE_MAX) => `(max-width:${maxWidth}px), ${PHONE_SIDEWAYS}`;
export const PHONE_Q = phoneQuery();
