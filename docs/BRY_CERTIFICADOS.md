# Assinatura digital — A1/A3 Bry e A1/A3 externo

Mapa dos quatro tipos de certificado que o app precisa suportar e onde cada
um vive no código. `CertificateProviderFactory` cobre os três primeiros;
o quarto (Integra Bry) é um fluxo à parte, sem credencial persistente.

| Tipo | Onde a chave fica | `provider` em `doctor_certificates` | Módulo |
|---|---|---|---|
| A1 externo | Arquivo `.pfx/.p12` do usuário, guardado no Storage privado | `local` | `providers/LocalCertificateProvider.server.ts` |
| A1 Bry | HSM da própria BRy (BRyKMS) | `bry_cloud` (`certificate_subtype: "a1"`) | `providers/BryCloudCertificateProvider.server.ts` + `src/lib/bry/kms.server.ts` |
| A3 Bry | HSM da própria BRy (BRyKMS) | `bry_cloud` (`certificate_subtype: "a3"`) | idem — mesmo endpoint, `kms_data` idêntico; a distinção hoje é só de metadado/UI |
| A3 externo | Nuvem de **outro** PSC (BirdID/Soluti, Vidaas/Valid, SafeID/Safeweb, RemoteID/Certisign, SerproID, Syn/Syngular, DS Cloud) | *não vira linha em `doctor_certificates`* | `src/lib/bry/integraBry.server.ts` + `SignatureService.{start,complete}IntegraBryLink` / `signWithIntegraBry` |

## Por que A3 externo não é um `CertificateProvider`

Os outros três tipos seguem o mesmo contrato: o médico cadastra uma vez
(`authenticate`), o app guarda uma referência em `doctor_certificates`, e
toda assinatura futura reusa essa referência (`signDocument`).

O Integra Bry não se encaixa nesse molde porque a credencial que ele gera
(`X-API-KEY`) nasce com um `lifetime` (180 a 604800 segundos — o "tempo de
vida da requisição" citado pelas outras certificadoras; usamos 12h como
padrão) e um `scope` que normalmente é `single_signature`: uma credencial
por assinatura, não uma credencial permanente. Por isso ele vive em
`signature_psc_link_sessions` (TTL 15 min até ser linkada, depois válida
até o `lifetime` do link) em vez de em `doctor_certificates`.

## Fluxo A3 externo (Integra Bry)

1. `POST /api/signature/integra-bry/link` — o app pede à BRy um link de
   autenticação para o PSC escolhido pelo médico (`pscName`, ex.: `"BirdID"`).
   A BRy responde com uma `authorizationUrl`.
2. O médico abre essa URL, autentica no PSC (login do PSC — pode incluir o
   QR Code do próprio PSC, isso é responsabilidade dele, fora do controle
   da BRy) e escolhe o certificado a usar.
3. O PSC redireciona de volta para a `redirectUri` que informamos, com
   `?state=...` na query string.
4. `POST /api/signature/integra-bry/callback` — o app confirma a sessão
   pelo `state` e busca os dados do certificado escolhido
   (`GET /auth/info` + `GET /auth/certificate`).
5. `POST /api/signature/integra-bry/sign` — assina o PDF usando a sessão
   linkada.

```
Link (POST /integra-bry/link)
        │
        ▼
Médico autentica no PSC e escolhe o certificado
        │
        ▼
Redirect de volta com ?state=...
        │
        ▼
Callback confirma a sessão (POST /integra-bry/callback)
        │
        ▼
Assinatura (POST /integra-bry/sign)
```

## Detecção automática do retorno (sem clique manual)

`public/integra-bry-connect.js` é o módulo compartilhado (carregado uma vez
em `medicopilot.html`, usado por `equipe.js` e pelas telas de documento).
Ele abre a autenticação numa nova aba e resolve sozinho, sem precisar de
nenhum "Já autorizei, continuar":

1. **postMessage**: a aba nova (que recebe o `?state=...` de volta do PSC)
   confirma o vínculo e avisa a aba original via `window.opener.postMessage`.
   Por isso o `window.open` é feito **sem** `"noopener"` — precisamos manter
   a referência de `opener`. Trade-off consciente: como o destino é o login
   de um PSC parceiro (não um site arbitrário), o risco de reverse
   tabnabbing é baixo, mas é uma escolha deliberada, não um descuido.
2. **Polling de reforço**: a aba original também pergunta periodicamente
   (a cada 4s) se a sessão já foi linkada, caso o `postMessage` falhe por
   algum motivo. Para de tentar depois de ~10 min ou se a aba nova foi
   fechada sem concluir.

`window.IntegraBryConnect.promptAndConnect(token, { cpf, title })` é a
função de mais alto nível: mostra um overlay autônomo (não depende de
nenhum sistema de modal existente), lista os PSCs, deixa escolher, conecta
e resolve — pensada pra ser chamada de **qualquer tela**, inclusive no meio
da criação de um documento.

## Reconectar sem perder o que já foi preenchido

Cenário que motivou isso: médico preenche uma receita com vários
medicamentos, clica em assinar, e o certificado (A3 externo) expirou. Sem
essa mudança, ele precisaria fechar a receita, ir em "Minha equipe",
reconectar, voltar e preencher tudo de novo.

Agora, em `_assinarPdfBase64` (geração/assinatura da receita) e em
`executarForcarAssinatura` (reassinar um documento já gerado), quando a
API retorna `credential_expired`, o app chama `promptAndConnect` **ali
mesmo, sem navegar pra lugar nenhum** — o formulário por trás do overlay
continua intacto — e tenta assinar de novo automaticamente assim que a
Bry confirmar o vínculo. Se o médico cancelar o overlay, cai no
comportamento de sempre (gera o PDF sem assinatura, com aviso).

## O que está confirmado vs. o que precisa validação

**Confirmado** contra `bry-developer.readme.io/reference/integra-bry` (fetch
em 2026-08-24):
- `GET /api/service/psc/list` — lista de PSCs.
- `POST /api/service/psc/link` — corpo: `pscName`, `redirectUri`, `state`,
  `numberOfDocuments`, `scope` (`single_signature` | `multi_signature` |
  `signature_session`), `lifetime` (180–604800s), `cpf`/`cnpj`.
- `GET /api/service/auth/info` e `GET /api/service/auth/certificate`,
  autenticados com header `X-API-KEY`.
- URLs base: homologação `https://integra.hom.bry.com.br/api/service`,
  produção `https://integra.bry.com.br/api/service`.

**Não confirmado** (exemplos de request/response ficam atrás de login em
`bry-developer.readme.io`; não temos acesso de parceiro):
- O corpo/resposta exato de `POST /psc/link` — em particular, se o
  `X-API-KEY` vem *nessa* resposta ou só é anexado ao redirect de volta.
  `IntegraBryApi.createLink()` tenta os dois formatos mais comuns
  (`apiKey`/`api_key`/`credential`); se nenhum vier, `completeIntegraBryLink`
  aceita receber o valor do callback (`apiKeyFromCallback`).
- O endpoint e o header exatos da assinatura em si depois de linkado. A
  intro da doc diz para reaproveitar `fw/v1/pdf/kms/lote/assinaturas` (mesmo
  do BRyKMS, ver `kms.server.ts`) só trocando a URL base — é o que
  `IntegraBryApi.signPdf()` implementa, com `X-API-KEY` no lugar de
  `Authorization: Bearer + kms_type`. Isso **precisa ser validado** contra
  a coleção Postman oficial (`https://integra.bry.com.br/postman.json`)
  ou em homologação antes de qualquer uso em produção — o código já lança
  um erro explícito em vez de assumir sucesso se a resposta vier fora do
  formato esperado.

## Autenticação da aplicação (importante — corrigido em 2026-08-29)

A API da BRy usa OAuth2 client credentials (confirmado em
`bry-developer.readme.io/reference/autentication-doc` e
`.../post_token-service-jwt`). O `access_token` **expira em poucos
minutos** — não é uma credencial estática que se configura uma vez.
`src/lib/bry/authToken.server.ts` obtém e renova esse token
automaticamente, chamando:

```
Homologação: POST https://cloud-hom.bry.com.br/token-service/jwt
Produção:    POST https://cloud.bry.com.br/token-service/jwt
Content-Type: application/x-www-form-urlencoded
Body: grant_type=client_credentials&client_id=...&client_secret=...
```

**Variáveis de ambiente:**
- `BRY_CLIENT_ID` / `BRY_CLIENT_SECRET` — obtidas uma única vez no portal
  Bry Cloud (`cloud.bry.com.br` ou `cloud-hom.bry.com.br` para
  homologação), menu **Gestão > Minhas aplicações > emitir client_secret**.
  Essas sim são estáveis e não expiram.
- `BRY_ENV` (`hom` | `prod`, padrão `hom`) — escolhe o ambiente de auth.
- `BRY_AUTH_BASE_URL` — sobrescreve a URL do serviço de token diretamente.
- `INTEGRA_BRY_ENV` / `INTEGRA_BRY_BASE_URL` — mesma coisa, mas para a URL
  base do Integra Bry especificamente (separada da URL de autenticação).
- `BRY_HUB_TOKEN` / `BRY_API_TOKEN` — **legado**: token estático usado como
  fallback só se `BRY_CLIENT_ID`/`BRY_CLIENT_SECRET` não estiverem
  configurados. Como o token real expira em minutos, esse fallback só
  funciona por pouco tempo depois de configurado — não é uma solução
  permanente, migre para `BRY_CLIENT_ID`/`BRY_CLIENT_SECRET`.

**Causa raiz de um bug real encontrado**: antes desta correção, tanto
`kms.server.ts` (bry_cloud/BRyKMS) quanto `integraBry.server.ts` liam um
`BRY_HUB_TOKEN` estático do ambiente e o usavam para sempre como
`Authorization: Bearer`. Como esse token expira em minutos, qualquer
assinatura tentada depois da janela inicial de validade falhava com erro
502 — sintoma reportado como "Falha ao consultar as certificadoras
(502)".

## Histórico

Uma primeira versão deste documento descrevia A3 externo como token/
smartcard físico local, assinado via extensão de navegador/driver
PKCS#11 (fluxo de duas fases: `prepareA3ExternoSignSession` +
`finalizeA3ExternoSignature`, tabela `signature_sign_sessions`). Essa
abordagem foi substituída pelo Integra Bry — na prática, a maioria dos
certificados "externos" hoje já é hospedada na nuvem de outro PSC, não
um token USB. Ver migration `20260824130000_integra_bry_link_sessions.sql`.
