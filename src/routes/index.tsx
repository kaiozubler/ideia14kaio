import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediCopilot" },
      { name: "description", content: "Agenda, prontuários e assistência clínica no MediCopilot." },
      { property: "og:title", content: "MediCopilot" },
      { property: "og:description", content: "Agenda, prontuários e assistência clínica no MediCopilot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    // Mantém ?code= / #access_token= do link de confirmação de e-mail, senão o
    // app abre deslogado e a conta nova não passa pela tela de planos.
    window.location.replace(`/medicopilot.html${window.location.search}${window.location.hash}`);
  }, []);

  return null;
}
