import PageShell from "../components/PageShell";
import { SetPassword } from "../components/site/SetPassword";

export default function SetPasswordPage() {
  return (
    <>
      <PageShell title="Set your password — Defied MGMT" description="Choose your password." path="/set-password" noindex />
      <SetPassword />
    </>
  );
}
