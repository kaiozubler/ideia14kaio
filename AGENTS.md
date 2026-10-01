# Architecture decisions

- Integra BRy stores the `/psc/link` response `token` as the session X-API-KEY; `state` is only a callback correlation value, because BRy rejects `state` as a credential.
- Integra BRy link sessions persist the same lifetime sent to `/psc/link`, because the local expiry must not invalidate a still-authorized PSC session.
- Integra BRy PDF signing uses the HUB Signer endpoint with `kms_type: PSC` and `kms_data: { url, token }`, because X-API-KEY is only for the Integra authentication-information endpoints.
- Server-side PDF generation uses pure JavaScript libraries only, because native browser binaries are unavailable in the production runtime.
- Protocols are authored in the Studio (`public/protocolo-studio.html`) and published by compiling the graph into `protocolo_acoes`/`protocolo_regras` through `salvar_protocolo`, because the task/exam/alert engine only executes that relational model.
- Studio publishing stores a graph-key → uuid map in `protocolo_estudio_rascunhos.publicacao` and resends those uuids, because recreating actions cascades away patients' task history.
- Conditions the engine cannot evaluate (medication state, pregnancy/weight, AND across different exams) and same-group drug alternatives compile to "Decidir"/"Escolher" alert tasks whose rules match the doctor's choice as `{texto: <branch id>}`, because silently dropping those branches would lose treatment lines.
- The clinic ↔ patient WhatsApp channel (Conversas screen) uses each clinic's own Meta Cloud API credentials, stored AES-GCM-encrypted in `comunicacao_whatsapp_conexoes`, never the global `WHATSAPP_*` env vars, because those belong to the app's single number used by the doctor ↔ assistant channel.
- Clinic webhooks are served at `/api/public/webhooks/whatsapp-clinica/<webhook_chave>` and require the clinic's App Secret, because Meta's GET verification carries no `phone_number_id` and an unsigned URL would let anyone inject fake patient messages.
- Message templates are written only through `/api/comunicacao/modelos`, because their status mirrors Meta's review; free-form sends are blocked outside the 24h customer-service window, where documents fall back to the template chosen in `comunicacao_whatsapp_automacoes.documento_modelo_id`.
