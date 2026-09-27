# Architecture decisions

- Integra BRy stores the `/psc/link` response `token` as the session X-API-KEY; `state` is only a callback correlation value, because BRy rejects `state` as a credential.
- Integra BRy link sessions persist the same lifetime sent to `/psc/link`, because the local expiry must not invalidate a still-authorized PSC session.