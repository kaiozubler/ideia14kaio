# Architecture decisions

- Integra BRy stores the `/psc/link` response `token` as the session X-API-KEY; `state` is only a callback correlation value, because BRy rejects `state` as a credential.
- Integra BRy link sessions persist the same lifetime sent to `/psc/link`, because the local expiry must not invalidate a still-authorized PSC session.
- Integra BRy PDF signing uses the HUB Signer endpoint with `kms_type: PSC` and `kms_data: { url, token }`, because X-API-KEY is only for the Integra authentication-information endpoints.
- Server-side PDF generation uses pure JavaScript libraries only, because native browser binaries are unavailable in the production runtime.