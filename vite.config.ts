// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
// @ts-expect-error -- script .mjs sem tipos
import { atualizarZip } from "./scripts/empacotar-extensao.mjs";

// Regera public/medicopilot-extension.zip a partir de extension/ antes de cada
// build, para o pacote baixado em Minha equipe nunca ficar para trás.
const pacoteExtensao = {
  name: "medicopilot-pacote-extensao",
  apply: "build" as const,
  buildStart() {
    if (atualizarZip()) console.log("[extensao] medicopilot-extension.zip atualizado");
  },
};

export default defineConfig({
  vite: { plugins: [mcpPlugin(), pacoteExtensao] },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
