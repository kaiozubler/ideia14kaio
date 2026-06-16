# Integração Deepgram — Transcrição ao vivo (pt-BR)

## Objetivo
Substituir o mock de transcrições do Copiloto por transcrição real do microfone via Deepgram, em tempo real, em português brasileiro.

## Como vai funcionar (visão do usuário)
1. Ao clicar em "Iniciar atendimento" / ativar a escuta, o navegador pede permissão de microfone.
2. O áudio é enviado ao Deepgram em streaming; frases aparecem no painel de transcrição assim que são reconhecidas (parciais em cinza, finais consolidadas).
3. Ao pausar/encerrar, o stream é fechado e o texto final fica salvo em `transcriptLog` (já usado pela IA da Anamnese e pelo Resumo do atendimento).

## Arquitetura (segura)
A chave Deepgram nunca vai ao navegador. Fluxo:

```
Browser  ──(1) pede token──►  Server Function (TanStack)
Browser  ◄──(2) token efêmero (≈60s, scope:usage:write)──
Browser  ──(3) WebSocket wss://api.deepgram.com/v1/listen──►  Deepgram
Browser  ◄──(4) transcrições JSON (parcial/final)──────────
```

- Token efêmero é criado via `POST https://api.deepgram.com/v1/auth/grant` usando `DEEPGRAM_API_KEY` no servidor.
- Cliente abre WebSocket direto com Deepgram usando esse token (baixa latência, sem proxy de áudio).

## Passos de implementação

1. **Secret**: solicitar `DEEPGRAM_API_KEY` (via add_secret) após aprovação.
2. **Server function** `src/lib/deepgram.functions.ts`:
   - `getDeepgramToken` (`createServerFn`, sem auth pública por enquanto — pode ficar atrás de `requireSupabaseAuth` se preferir) → chama Deepgram Auth API e devolve `{ access_token, expires_in }`.
3. **Cliente em `public/medicopilot.html`**:
   - Novo módulo JS `deepgramLive` com: `start()`, `stop()`, `pause()`, `resume()`.
   - Usa `navigator.mediaDevices.getUserMedia({audio:true})` + `MediaRecorder` (mimeType `audio/webm;codecs=opus`, timeslice 250 ms).
   - Abre `WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&language=pt-BR&smart_format=true&interim_results=true&punctuate=true&endpointing=300', ['token', accessToken])`.
   - `ondataavailable` → `ws.send(blob)`.
   - `onmessage` → se `is_final` chama `addTranscriptLine(transcript)` (função já existente); se parcial, atualiza uma linha "ao vivo" no painel.
   - Tratamento de erros: permissão negada, token expirado (re-mint), perda de rede (reconnect com backoff).
4. **Substituir o mock**:
   - Remover/ignorar `transcripts[]` e o `setInterval` em `transcriptInterval` quando o Deepgram estiver ativo.
   - Manter fallback ao mock atrás de uma flag `USE_DEEPGRAM` para desenvolvimento offline (opcional).
   - Respeitar o toggle "Permitir gravação de voz" (linha 1062) — só inicia se estiver ligado.
5. **UI**:
   - Indicador "● ao vivo" já existe; trocar para refletir estado real (`connecting`, `live`, `paused`, `error`).
   - Mostrar parcial em itálico/cinza claro acima das finais.

## Detalhes técnicos

- **Endpoint token**: `POST /v1/auth/grant` com header `Authorization: Token <API_KEY>`, body `{"ttl_seconds":60}`. Retorna `access_token`.
- **Parâmetros Deepgram**: `model=nova-2`, `language=pt-BR`, `interim_results=true`, `smart_format=true`, `punctuate=true`, `endpointing=300`, `vad_events=true`.
- **Encoding**: enviar `audio/webm;opus` direto — Deepgram detecta. Em Safari (`audio/mp4`) idem.
- **Keepalive**: enviar `{"type":"KeepAlive"}` a cada 8s para não desconectar em silêncio.
- **Fechamento limpo**: enviar `{"type":"CloseStream"}` antes de `ws.close()` para receber transcrição final pendente.
- **Custo**: Nova-2 streaming ≈ US$0.0043/min.

## Fora de escopo (proposto p/ próximos passos)
- Diarização (identificar quem falou — médico × paciente).
- Salvar áudio bruto no storage.
- Transcrição pós-gravação (upload) como fallback.

Confirme para eu pedir o `DEEPGRAM_API_KEY` e implementar.
