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
    window.location.replace("/medicopilot.html");
  }, []);

  return null;
}
