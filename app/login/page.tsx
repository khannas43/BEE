import { LoginPageClient } from "@/components/login/LoginPageClient";

export const dynamic = "force-dynamic";

/** Resolve demo mode on the server so remote visitors receive the login form in the first HTML response. */
export default function LoginPage() {
  return <LoginPageClient demo={process.env.BEE_DEMO_LOGIN === "1"} />;
}
