import { redirect } from "next/navigation";
import { HeartPulse } from "lucide-react";
import { changeRequiredPassword } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("must_change_password").eq("id", claims.claims.sub).single();
  if (!profile?.must_change_password) redirect("/patients");
  const params = await searchParams;
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><span><HeartPulse/></span><div><h1>Hospital ONE</h1><p>Secure staff access</p></div></div>
    <h2>Create your permanent password</h2>
    <p className="subtext">Your temporary password worked. Set a private password before accessing facility records.</p>
    {params.error ? <div className="form-error">{params.error}</div> : null}
    <form action={changeRequiredPassword} className="form-stack">
      <label>New password<input required minLength={12} type="password" name="password" autoComplete="new-password"/></label>
      <label>Confirm new password<input required minLength={12} type="password" name="password_confirmation" autoComplete="new-password"/></label>
      <p className="security-note">Use at least 12 characters with uppercase, lowercase, number, and symbol.</p>
      <button className="btn btn-primary">Save password and continue</button>
    </form>
  </section></main>;
}
