// r11: Outreach is gone (the owner: "the whole outreach tab dont make no sense anymore"), and with it To do's
// "A&R follow-ups due" row: /api/ar?summary=1 no longer counts follow-ups, so todo-data.js never lists that row and
// this panel is never opened. It stays only so components/dash/todo.jsx's lazy import still resolves; it reads and
// shows nothing. (Delete it together with todo.jsx's "follow" case.)
export function ArFollowUps() {
  return null;
}
