import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

function configuredEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
}

function publishableKey() {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;
  try {
    const keys: unknown = JSON.parse(process.env.SUPABASE_PUBLISHABLE_KEYS ?? "{}");
    if (keys && typeof keys === "object" && !Array.isArray(keys)) {
      const values = keys as Record<string, unknown>;
      const key = [values.default, ...Object.values(values)].find((v): v is string => typeof v === "string" && v.startsWith("sb_publishable_"));
      if (key) return key;
    }
  } catch { /* Legacy key fallback. */ }
  return configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
}

export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!ctx.isAuthenticated() || !token) throw new ToolError("Entre na sua conta para consultar os dados.");
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = publishableKey();
  if (!url || !key) throw new ToolError("A conexão de dados não está disponível.");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}