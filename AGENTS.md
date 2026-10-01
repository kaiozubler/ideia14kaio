# Architecture decisions

- Integra BRy stores the `/psc/link` response `token` as the session X-API-KEY; `state` is only a callback correlation value, because BRy rejects `state` as a credential.
- Integra BRy link sessions persist the same lifetime sent to `/psc/link`, because the local expiry must not invalidate a still-authorized PSC session.
- Integra BRy PDF signing uses the HUB Signer endpoint with `kms_type: PSC` and `kms_data: { url, token }`, because X-API-KEY is only for the Integra authentication-information endpoints.
- Server-side PDF generation uses pure JavaScript libraries only, because native browser binaries are unavailable in the production runtime.
- Protocols are authored in the Studio (`public/protocolo-studio.html`) and published by compiling the graph into `protocolo_acoes`/`protocolo_regras` through `salvar_protocolo`, because the task/exam/alert engine only executes that relational model.
- Studio publishing stores a graph-key → uuid map in `protocolo_estudio_rascunhos.publicacao` and resends those uuids, because recreating actions cascades away patients' task history.
- Conditions the engine cannot evaluate (medication state, pregnancy/weight, AND across different exams) and same-group drug alternatives compile to "Decidir"/"Escolher" alert tasks whose rules match the doctor's choice as `{texto: <branch id>}`, because silently dropping those branches would lose treatment lines.
