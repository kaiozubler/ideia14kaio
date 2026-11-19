import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("../drizzle/migrations/0000_restrict_interactions_and_tuss_logs.sql", import.meta.url),
  "utf8",
);

test("shared interaction reads require a signed-in, non-suspended caller", () => {
  assert.match(sql, /ALTER POLICY "Interacoes leitura autenticada" ON public\.interacoes\s+TO authenticated/);
  assert.match(sql, /USING \(\(SELECT auth\.uid\(\)\) IS NOT NULL AND NOT public\.acesso_bloqueado\(\(SELECT auth\.uid\(\)\)\)\)/);
  assert.match(sql, /GRANT SELECT ON public\.interacoes TO authenticated/);
  assert.match(sql, /REVOKE ALL ON public\.interacoes FROM anon/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.interacoes FROM authenticated/);
});

test("TUSS synchronization logs are service-role-only", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "tuss_log_leitura_autenticada" ON public\.tuss_sync_log/);
  assert.match(sql, /REVOKE ALL ON public\.tuss_sync_log FROM anon, authenticated/);
  assert.match(sql, /GRANT ALL ON public\.tuss_sync_log TO service_role/);
});

test("the migration touches only the two selected tables and retains RLS", () => {
  const tables = [...sql.matchAll(/(?:ON|TABLE) public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["interacoes", "tuss_sync_log"]);
  for (const table of tables) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(sql, /USING\s*\(true\)/i);
});