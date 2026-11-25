// (2026-11-25, mobile) What a phone is, for every phone switch in JS (components/ui/responsive.jsx re-exports these; components/ui/mobile.css
// mirrors them): under 640px wide, or a touch screen under 500px tall, i.e. a phone held sideways (844x390, 667x375), which used to get the
// desktop or tablet layout. A screen with a width of its own (A&R's cards at 699px, To do's week at 599px) keeps it: phoneQuery(699).
export const PHONE_MAX = 639;
export const PHONE_SIDEWAYS = "(pointer:coarse) and (max-height:500px)";
export const phoneQuery = (maxWidth = PHONE_MAX) => `(max-width:${maxWidth}px), ${PHONE_SIDEWAYS}`;
export const PHONE_Q = phoneQuery();
