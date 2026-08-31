// Server-side mirror of the same id() used throughout components/App.jsx —
// kept identical so ids generated on either side look the same.
export const uid = () => Math.random().toString(36).slice(2, 10);
