import PageShell from "../components/PageShell";
import { useApp } from "../components/app/AppRoot";
import { Login } from "../components/site/Login";

export default function LoginPage() {
  const { login, notice } = useApp();
  return (
    <>
      <PageShell
        title="Sign in — Defied MGMT"
        description="Staff and client sign in."
        path="/login"
        noindex
      />
      <Login login={login} notice={notice} />
    </>
  );
}
