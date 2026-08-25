# Assinatura digital ICP-Brasil — A1 Bry, A3 Bry, A1 externo, A3 externo

Este documento descreve como os quatro tipos de certificado do médico se
encaixam na arquitetura plugável já existente (`CertificateProviderFactory`
+ interface `CertificateProvider`, em `src/lib/signature/`).

> Não confundir com `src/lib/bry/` + `src/routes/api/bry/*` (BRy Easy Sign /
> "coleta de assinaturas"): aquele fluxo é para **assinatura eletrônica do
> paciente** (sem certificado, por e-mail/link). Este documento é sobre a
> **assinatura digital do médico** com certificado ICP-Brasil.

## Os quatro tipos e onde cada um vive

| Tipo | `provider` | Onde a chave privada mora | Como assina |
|---|---|---|---|
| A1 externo | `local` | Arquivo `.pfx/.p12` do usuário, guardado em Storage privado | Servidor abre o PKCS#12 com a senha (nunca persistida) e assina localmente com `node-forge`. Não usa a API da Bry. |
| A1 Bry | `bry_cloud` (`certificate_subtype = "a1"`) | HSM da BRy (Certificado em Nuvem / BRyKMS) | Uma chamada síncrona ao `hub2.bry.com.br/fw/v1/pdf/kms/lote/assinaturas` com CPF + PIN. PIN nunca é persistido. |
| A3 Bry | `bry_cloud` (`certificate_subtype = "a3"`) | HSM da BRy (Certificado em Nuvem / BRyKMS) | Mesmo endpoint do A1 Bry — a HSM resolve o tipo internamente. A distinção A1/A3 aqui é só metadado para rótulo/regras de UI. |
| A3 externo | `bry_a3_externo` | Token USB / smart card físico do usuário | Fluxo de duas fases (ver abaixo) — a chave nunca sai do dispositivo e o servidor nunca a acessa. |

`integra_icp` continua existindo como agregador legado (não é Bry).

## Por que A3 externo precisa de duas fases

O servidor não alcança hardware local (token/smartcard no computador do
médico). Diferente do A1/A3 Bry (chave na nuvem, servidor fala direto com a
HSM), aqui é o **navegador** que precisa acionar o driver do token. Isso
significa duas chamadas HTTP com uma operação local no meio:

```
1. POST /api/signature/a3-externo/prepare
   servidor: monta o placeholder PAdES no PDF, calcula o digest exato
   (SHA-256 dos bytes cobertos pelo ByteRange) e devolve
   { signSessionId, digestBase64 }. Sessão válida por 15 min
   (tabela signature_sign_sessions).

2. [no navegador] o driver/middleware do token assina o digest
   (RSA-SHA256) e monta o CMS/PKCS#7 detached com o certificado do
   token — isso ainda NÃO está implementado neste repositório, é o
   componente que falta (ver "O que falta" abaixo).

3. POST /api/signature/a3-externo/finalize
   servidor: recebe { signSessionId, cmsBase64 }, espeta a assinatura
   de volta no PDF exatamente na posição reservada e sobe o PDF
   assinado para o Storage (mesmo destino de signDocument()).
```

A divisão do PDF em duas fases replica **bit a bit** o algoritmo interno de
`@signpdf/signpdf` (`SignPdf.sign()`), só parando exatamente antes de
escrever a assinatura — ver `preparePlaceholder` / `finalizeWithCms` em
`src/lib/signature/PadesEmbedder.server.ts`. Isso garante que o digest
assinado no token é o mesmo que teria sido gerado no fluxo síncrono
(A1 externo / IntegraICP).

## O que falta para A3 externo funcionar ponta a ponta

O backend está pronto (provider, rotas, sessão de 15 min). Falta o
componente client-side que:

1. Enumera os certificados A3 disponíveis no token/smartcard conectado
   (tipicamente via um middleware do fabricante — SafeSign, Watchdata,
   Athena etc. — já que browsers modernos não suportam mais plugins
   PKCS#11 diretamente).
2. Assina o `digestBase64` devolvido por `/prepare` com a chave privada do
   token (RSA-SHA256) e monta um CMS/PKCS#7 *detached* contendo o
   certificado + a assinatura.
3. Envia o resultado para `/finalize`.

Isso normalmente é feito com uma pequena aplicação local ("Web PKI"-style,
como Lacuna Web PKI ou o "App Desktop" da própria BRy) que expõe uma API
HTTP local (`localhost:xxxx`) para o navegador conversar com o driver do
token. Vale confirmar com o time de integração da Bry se eles têm um
componente equivalente pronto antes de construir um do zero.

## Registro (`/api/signature/authenticate`)

```jsonc
// A1 Bry
{ "provider": "bry_cloud", "cpf": "...", "certificateType": "a1", "holderName": "..." }

// A3 Bry
{ "provider": "bry_cloud", "cpf": "...", "certificateType": "a3", "holderName": "..." }

// A3 externo (não guarda segredo nenhum — só CPF/rótulo)
{ "provider": "bry_a3_externo", "cpf": "...", "holderName": "..." }

// A1 externo — rota separada, envia o .pfx/.p12 + senha
// POST /api/signature/register-local (ver SignatureService.registerLocalCertificate)
```

## Migração

`supabase/migrations/20260824120000_bry_a1_a3_split_e_a3_externo.sql`:
adiciona `doctor_certificates.certificate_subtype` (a1 | a3 | a3_token) e a
tabela `signature_sign_sessions` (mesmo padrão de TTL/RLS de
`signature_pkce_sessions`, já existente).
