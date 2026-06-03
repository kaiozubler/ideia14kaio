import { createFileRoute } from "@tanstack/react-router";

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
  return (
    <iframe
      src="/medicopilot.html"
      title="MediCopilot"
      style={{ border: 0, width: "100vw", height: "100vh", display: "block" }}
    />
  );
}
