# Architecture decisions

- Read `docs/architecture-rules.md` before changes; it preserves the existing signature, protocol, clinic and document invariants.
- Agent integrations use OAuth-protected read-only MCP tools in `src/lib/mcp/` and forward verified caller tokens to RLS, because external assistants must preserve clinic permissions.
- MCP consent uses a dedicated public login callback with a validated same-origin return path, because the legacy static entry cannot preserve an authorization request.
- Browser-local MCP registrations remain in their owning React screens and cannot approve consent, because authorization requires a human decision.
