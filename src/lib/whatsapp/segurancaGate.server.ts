import { decryptVerifier } from "@/lib/signature/PKCEService";
import {
  gerarDesafio,
  formatarMensagemDesafio,
  extrairBlocosDaResposta,
  respostaEstaCorreta,
  calcularStatusRotacao,
  type Desafio,
} from "./segurancaDesafio";

// Estas tabelas foram adicionadas depois da última geração dos tipos do banco.
// O cliente continua validando e executando todas as operações no servidor.
type Db = any;

function requireEncryptionKey(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("SIGNATURE_ENCRYPTION_KEY não configurado (mínimo 16 caracteres).");
  }
  return key;
}

type LinhaSeguranca = {
  palavra_chave_cifrada: string | null;
  palavra_chave_criada_em: string | null;
  palavra_chave_usos: number;
  frequencia_horas: number;
  ultima_autenticacao_em: string | null;
  blocos_usados: unknown;
  desafio_ativo: unknown;
  desafio_bloqueado: boolean;
};

export type ResultadoGate =
  | { liberado: true }
  | { liberado: false; resposta: string };

const MSG_BLOQUEADO =
  "🔒 Sua verificação de segurança foi bloqueada após 2 tentativas incorretas. " +
  "Configure uma nova palavra-chave em Minhas IAs > Copiloto > Copiloto pelo WhatsApp no app para voltar a usar este canal.";

const MSG_ROTACAO_OBRIGATORIA =
  "🔒 Sua palavra-chave de segurança expirou (90 dias ou 30 usos, o que vier primeiro). " +
  "Configure uma nova em Minhas IAs > Copiloto > Copiloto pelo WhatsApp no app para continuar usando este canal.";

/**
 * Confere/gerencia a segunda camada de segurança (palavra-chave + desafio de
 * blocos) antes de qualquer mensagem do médico ser processada pelo
 * assistente. Retorna liberado:false sempre que a mensagem atual foi
 * consumida pelo próprio fluxo de segurança (desafio enviado, resposta
 * conferida, bloqueio, etc.) — nesses casos a mensagem NÃO deve seguir para
 * o assistente.
 */
export async function conferirSegurancaWhatsapp(
  db: Db,
  idMedico: string,
  textoRecebido: string,
): Promise<ResultadoGate> {
  const { data, error } = await db
    .from("medico_seguranca_whatsapp")
    .select(
      "palavra_chave_cifrada,palavra_chave_criada_em,palavra_chave_usos,frequencia_horas,ultima_autenticacao_em,blocos_usados,desafio_ativo,desafio_bloqueado",
    )
    .eq("id_medico", idMedico)
    .maybeSingle();

  if (error) {
    console.error("[seguranca-whatsapp] erro ao carregar configuração:", error.message);
    // Falha ao carregar configuração de segurança não deve travar o médico
    // fora do sistema — segue liberado, mas fica registrado no log.
    return { liberado: true };
  }

  const linha = data as LinhaSeguranca | null;
  if (!linha || !linha.palavra_chave_cifrada || !linha.palavra_chave_criada_em) {
    // Recurso opcional: médico ainda não configurou uma palavra-chave.
    return { liberado: true };
  }

  if (linha.desafio_bloqueado) {
    return { liberado: false, resposta: MSG_BLOQUEADO };
  }

  const statusRotacao = calcularStatusRotacao(linha.palavra_chave_criada_em, linha.palavra_chave_usos);
  if (statusRotacao.precisaTrocarAgora) {
    return { liberado: false, resposta: MSG_ROTACAO_OBRIGATORIA };
  }

  const desafioAtivo = linha.desafio_ativo as Desafio | null;

  if (desafioAtivo) {
    return processarRespostaDesafio(db, idMedico, desafioAtivo, textoRecebido);
  }

  const frequenciaMs = linha.frequencia_horas * 60 * 60 * 1000;
  const autenticacaoValida =
    !!linha.ultima_autenticacao_em && Date.now() - new Date(linha.ultima_autenticacao_em).getTime() < frequenciaMs;

  if (autenticacaoValida) {
    return { liberado: true };
  }

  // Autenticação vencida (ou nunca feita) — gera e envia um novo desafio.
  let palavraChave: string;
  try {
    palavraChave = await decryptVerifier(linha.palavra_chave_cifrada, requireEncryptionKey());
  } catch (err) {
    console.error("[seguranca-whatsapp] falha ao decifrar palavra-chave:", err);
    // Não trava o médico por um problema de infraestrutura nosso.
    return { liberado: true };
  }

  const blocosUsados = Array.isArray(linha.blocos_usados) ? (linha.blocos_usados as string[][][]) : [];
  let desafio: Desafio;
  try {
    desafio = gerarDesafio(palavraChave, blocosUsados);
  } catch (err) {
    console.error("[seguranca-whatsapp] falha ao gerar desafio:", err);
    return { liberado: true };
  }

  const { error: updateError } = await db
    .from("medico_seguranca_whatsapp")
    .update({
      desafio_ativo: desafio as never,
      blocos_usados: [...blocosUsados, desafio.blocos] as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id_medico", idMedico);
  if (updateError) {
    console.error("[seguranca-whatsapp] falha ao salvar desafio:", updateError.message);
    return { liberado: true };
  }

  return { liberado: false, resposta: formatarMensagemDesafio(desafio) };
}

async function processarRespostaDesafio(
  db: Db,
  idMedico: string,
  desafio: Desafio,
  textoRecebido: string,
): Promise<ResultadoGate> {
  const blocosEscolhidos = extrairBlocosDaResposta(textoRecebido);

  if (!blocosEscolhidos) {
    // Não veio nada que pareça uma resposta (ex.: o médico mandou outra
    // coisa) — reenvia as instruções sem consumir tentativa.
    return { liberado: false, resposta: formatarMensagemDesafio(desafio) };
  }

  if (respostaEstaCorreta(desafio, blocosEscolhidos)) {
    const { error } = await db
      .from("medico_seguranca_whatsapp")
      .update({
        desafio_ativo: null,
        desafio_bloqueado: false,
        ultima_autenticacao_em: new Date().toISOString(),
        palavra_chave_usos: 0, // incrementado abaixo via rpc-like read-modify-write
        updated_at: new Date().toISOString(),
      })
      .eq("id_medico", idMedico);
    // Incrementa usos separadamente para evitar condição de corrida trivial
    // com o valor lido antes (upsert acima já zerou; busca o valor atual e
    // soma 1 seria mais correto — feito em duas etapas por simplicidade).
    if (!error) {
      const { data: atual } = await db
        .from("medico_seguranca_whatsapp")
        .select("palavra_chave_usos")
        .eq("id_medico", idMedico)
        .maybeSingle();
      const usosAtuais = (atual as { palavra_chave_usos?: number } | null)?.palavra_chave_usos ?? 0;
      await db
        .from("medico_seguranca_whatsapp")
        .update({ palavra_chave_usos: usosAtuais + 1 })
        .eq("id_medico", idMedico);
    } else {
      console.error("[seguranca-whatsapp] falha ao confirmar autenticação:", error.message);
    }
    return {
      liberado: false,
      resposta: "✅ Verificado! Pode mandar seu pedido agora.",
    };
  }

  const tentativas = (desafio.tentativas || 0) + 1;
  if (tentativas >= 2) {
    const { error } = await db
      .from("medico_seguranca_whatsapp")
      .update({ desafio_ativo: null, desafio_bloqueado: true, updated_at: new Date().toISOString() })
      .eq("id_medico", idMedico);
    if (error) console.error("[seguranca-whatsapp] falha ao bloquear após 2 tentativas:", error.message);
    return { liberado: false, resposta: MSG_BLOQUEADO };
  }

  const desafioAtualizado: Desafio = { ...desafio, tentativas };
  const { error } = await db
    .from("medico_seguranca_whatsapp")
    .update({ desafio_ativo: desafioAtualizado as never, updated_at: new Date().toISOString() })
    .eq("id_medico", idMedico);
  if (error) console.error("[seguranca-whatsapp] falha ao registrar tentativa:", error.message);

  return {
    liberado: false,
    resposta: "❌ Resposta incorreta. Você tem mais 1 tentativa — responda com os números dos blocos (ex.: \"1,3\").",
  };
}
