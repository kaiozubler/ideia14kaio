import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, CalendarDays, Workflow } from "lucide-react";
import { useWebMCP } from "use-webmcp-tool";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ authorization_id: typeof search.authorization_id === "string" ? search.authorization_id : "" }),
  head: () => ({ meta: [
    { title: "Autorizar integração | MediCopilot" },
    { name: "description", content: "Revise e autorize o acesso de um assistente à sua conta MediCopilot." },
    { property: "og:title", content: "Autorizar integração | MediCopilot" },
    { property: "og:description", content: "Controle o acesso de assistentes à sua conta." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Pedido de autorização ausente. Inicie a conexão novamente no assistente.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login", search: { next: location.pathname + location.searchStr + location.hash } });
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.searchStr).get("authorization_id");
    if (!id) throw new Error("Pedido de autorização ausente.");
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error) throw new Error("Este pedido expirou ou não pôde ser carregado. Inicie a conexão novamente.");
    if (!data) throw new Error("Pedido de autorização indisponível.");
    if ("redirect_url" in data) throw redirect({ href: data.redirect_url });
    return data;
  },
  component: Consent,
  errorComponent: ConsentError,
});

function ConsentError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return <main className="min-h-screen bg-background px-6 py-16 text-foreground"><div className="mx-auto max-w-md space-y-5">
    <ShieldCheck className="size-10 text-primary" /><h1 className="text-2xl font-semibold">Autorização indisponível</h1>
    <p role="alert" className="text-muted-foreground">{error instanceof Error ? error.message : "Não foi possível carregar a autorização."}</p>
    <Button variant="outline" onClick={() => { reset?.(); void router.invalidate(); }}>Tentar novamente</Button>
  </div></main>;
}

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = details?.client.name ?? "Assistente";
  useWebMCP({
    name: "read_integration_request",
    description: "Lê o nome do assistente e as permissões mostradas neste pedido, sem autorizar o acesso.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => runWebMCPTool("read_integration_request", () => `${name}: consultar agenda e títulos dos protocolos, conforme as permissões da conta. ${busy ? "Decisão em andamento." : "Aguardando sua decisão."}`),
  });
  async function decide(approve: boolean) {
    setBusy(true); setError("");
    try {
      const { data, error } = approve
        ? await supabase.auth.oauth.approveAuthorization(authorization_id, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorization_id, { skipBrowserRedirect: true });
      if (error) throw new Error("Não foi possível registrar sua decisão. Tente novamente.");
      if (!data?.redirect_url) throw new Error("O assistente não informou um endereço de retorno.");
      window.location.assign(data.redirect_url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível concluir a autorização.");
      setBusy(false);
    }
  }
  return <main className="min-h-screen bg-background px-6 py-16 text-foreground"><div className="mx-auto max-w-md space-y-6">
    <ShieldCheck className="size-10 text-primary" /><p className="text-sm font-medium text-muted-foreground">MediCopilot · Integrações</p>
    <h1 className="break-words text-2xl font-semibold">Conectar {name}?</h1>
    <p className="break-all text-sm text-muted-foreground">Conta: {details?.user.email}</p>
    <ul className="space-y-4 border-y border-border py-5">
      <li className="flex gap-3"><CalendarDays className="size-5 shrink-0 text-primary" /><span>Consultar sua agenda</span></li>
      <li className="flex gap-3"><Workflow className="size-5 shrink-0 text-primary" /><span>Consultar títulos e situação dos protocolos</span></li>
    </ul>
    <p className="text-sm text-muted-foreground">O acesso respeita suas permissões na clínica. Não permite alterar dados, enviar mensagens ou acessar prontuários e certificados.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-3"><Button disabled={busy} onClick={() => void decide(true)}>Autorizar</Button><Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Recusar</Button></div>
  </div></main>;
}