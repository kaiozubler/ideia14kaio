import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediCopilot" },
      { name: "description", content: "MediCopilot MVP" },
      { property: "og:title", content: "MediCopilot" },
      { property: "og:description", content: "MediCopilot MVP" },
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
