# Agent integrations
- [x] Add OAuth-protected read-only MCP tools with caller-scoped data.
- [x] Add consent and login-return handling and browser-local read tools.
- [ ] Complete a real approve/deny connection on the published address — blocked until the app is published, because authorization only accepts that address.

# Ponte Zubler CRM
- [x] Rotas /api/public/crm/* (clínicas, usuários, pagamentos, contratações, cupons) com CRM_BRIDGE_TOKEN.
- [x] Tabelas acessos_bloqueados, pagamentos_manuais, crm_auditoria + função acesso_bloqueado(uid).
- [x] Bloqueio respeitado no login (medicopilot.html) e em toda /api/* (middleware em src/start.ts).
- [x] Rota /api/public/crm/health.
- [ ] Verificar build + testes da ponte e confirmar rotas respondendo.
