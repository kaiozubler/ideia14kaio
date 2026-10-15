import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ next: oauthReturnPath(search.next) }),
  head: () => ({ meta: [
    { title: "Entrar para conectar | MediCopilot" },
    { name: "description", content: "Entre na sua conta para autorizar uma integração do MediCopilot." },
    { property: "og:title", content: "Entrar para conectar | MediCopilot" },
    { property: "og:description", content: "Login seguro para autorizar uma integração." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(next);
    });
  }, [next]);
  async function signIn(google: boolean) {
    setBusy(true); setError("");
    try {
      if (google) {
        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: new URL(`/login?next=${encodeURIComponent(next)}`, window.location.origin).href,
        });
        if (result.error) throw result.error;
        if (result.redirected) return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Não foi possível confirmar o login. Tente novamente.");
      window.location.assign(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível entrar.");
    } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-background px-6 py-16 text-foreground"><div className="mx-auto max-w-sm space-y-6">
    <ShieldCheck className="size-10 text-primary" /><h1 className="text-2xl font-semibold">Entrar no MediCopilot</h1>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void signIn(false); }}>
      <label className="block space-y-2"><span>E-mail</span><Input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block space-y-2"><span>Senha</span><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={busy} type="submit">{busy ? "Aguarde…" : "Entrar"}</Button>
    </form>
    <Button className="w-full" variant="outline" disabled={busy} onClick={() => void signIn(true)}>Entrar com Google</Button>
  </div></main>;
}