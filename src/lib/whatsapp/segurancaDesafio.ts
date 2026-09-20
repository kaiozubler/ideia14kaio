/**
 * Segunda camada de segurança do canal Médico x assistente_ai pelo WhatsApp.
 *
 * A palavra-chave nunca é pedida/mostrada por inteiro depois de configurada.
 * Em vez disso, quando a autenticação é exigida, mandamos 4 blocos de 3
 * letras cada; o médico precisa identificar quais 2 blocos contêm ao menos
 * uma letra da palavra-chave dele. Isso confirma que quem está com o
 * telefone realmente conhece a palavra-chave, sem nunca transmiti-la de
 * volta por WhatsApp.
 */

export const FREQUENCIAS_VALIDAS = [6, 12, 24, 36] as const;
export type FrequenciaHoras = (typeof FREQUENCIAS_VALIDAS)[number];

export const PALAVRA_CHAVE_MIN_LENGTH = 12;
export const PALAVRA_CHAVE_MAX_REPETICAO = 2;

// Rotação obrigatória e aviso prévio.
export const ROTACAO_DIAS_OBRIGATORIA = 90;
export const ROTACAO_USOS_OBRIGATORIA = 30;
export const ROTACAO_DIAS_AVISO = 60;
export const ROTACAO_USOS_AVISO = 25;

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function normalizarLetra(c: string): string {
  return c
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Valida o formato da palavra-chave. Não julga "força" além do que foi pedido. */
export function validarPalavraChave(palavra: string): { valido: boolean; erro?: string } {
  const limpa = (palavra || "").trim();
  if (!/^[A-Za-zÀ-ÿ]+$/.test(limpa)) {
    return { valido: false, erro: "A palavra-chave deve conter apenas letras, sem espaços, números ou símbolos." };
  }
  if (limpa.length < PALAVRA_CHAVE_MIN_LENGTH) {
    return { valido: false, erro: `A palavra-chave precisa ter no mínimo ${PALAVRA_CHAVE_MIN_LENGTH} letras.` };
  }
  const contagem = new Map<string, number>();
  for (const c of limpa) {
    const norm = normalizarLetra(c);
    contagem.set(norm, (contagem.get(norm) || 0) + 1);
  }
  for (const [letra, qtd] of contagem) {
    if (qtd > PALAVRA_CHAVE_MAX_REPETICAO) {
      return {
        valido: false,
        erro: `A letra "${letra}" aparece ${qtd} vezes — nenhuma letra pode se repetir mais de ${PALAVRA_CHAVE_MAX_REPETICAO}x na palavra-chave.`,
      };
    }
  }
  return { valido: true };
}

function embaralhar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Assinatura canônica de um conjunto de blocos, para checar repetição em blocos_usados. */
function assinaturaBlocos(blocos: string[][]): string {
  return blocos
    .map((b) => [...b].sort().join(""))
    .sort()
    .join("|");
}

export type Desafio = {
  blocos: string[][]; // 4 blocos de 3 letras, na ordem mostrada ao médico (índice 0 = bloco "1")
  corretos: number[]; // números dos blocos certos, 1-based, ex.: [2,4]
  tentativas: number;
  criado_em: string;
};

/**
 * Gera um novo desafio: 2 blocos contêm exatamente 1 letra da palavra-chave
 * (+ 2 letras de preenchimento fora da palavra-chave), e 2 blocos não têm
 * nenhuma letra da palavra-chave. Nenhuma letra se repete entre os 4 blocos.
 * Tenta até 20 vezes gerar uma combinação que não esteja em blocosUsados
 * antes de desistir (extremamente improvável dado o espaço de combinações).
 */
export function gerarDesafio(palavraChave: string, blocosUsados: string[][][]): Desafio {
  const letrasChaveUnicas = Array.from(new Set([...palavraChave].map(normalizarLetra))).filter((l) =>
    ALFABETO.includes(l),
  );
  const assinaturasUsadas = new Set(blocosUsados.map((b) => assinaturaBlocos(b)));

  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const letrasChaveEmbaralhadas = embaralhar(letrasChaveUnicas);
    const letrasChavePraBlocos =
      letrasChaveEmbaralhadas.length >= 2
        ? letrasChaveEmbaralhadas.slice(0, 2)
        : [letrasChaveEmbaralhadas[0], letrasChaveEmbaralhadas[0]]; // segurança: min 12 letras já garante >=1 letra única

    const naoUsadas = embaralhar(ALFABETO.filter((l) => !letrasChaveUnicas.includes(l)));
    if (naoUsadas.length < 10) {
      // Extremamente improvável (exigiria uma palavra-chave cobrindo quase
      // todo o alfabeto), mas não deixa quebrar silenciosamente.
      throw new Error("Não há letras suficientes fora da palavra-chave para montar o desafio.");
    }

    // 2 blocos "positivos": 1 letra da chave + 2 letras de preenchimento.
    const blocoPositivo1 = embaralhar([letrasChavePraBlocos[0], naoUsadas[0], naoUsadas[1]]);
    const blocoPositivo2 = embaralhar([letrasChavePraBlocos[1], naoUsadas[2], naoUsadas[3]]);
    // 2 blocos "negativos": 3 letras de preenchimento, nenhuma da chave.
    const blocoNegativo1 = embaralhar([naoUsadas[4], naoUsadas[5], naoUsadas[6]]);
    const blocoNegativo2 = embaralhar([naoUsadas[7], naoUsadas[8], naoUsadas[9]]);

    const blocosComMarca: { letras: string[]; correto: boolean }[] = embaralhar([
      { letras: blocoPositivo1, correto: true },
      { letras: blocoPositivo2, correto: true },
      { letras: blocoNegativo1, correto: false },
      { letras: blocoNegativo2, correto: false },
    ]);

    const blocos = blocosComMarca.map((b) => b.letras);
    const assinatura = assinaturaBlocos(blocos);
    if (assinaturasUsadas.has(assinatura)) continue; // colisão rara — tenta de novo

    const corretos = blocosComMarca
      .map((b, i) => (b.correto ? i + 1 : null))
      .filter((n): n is number => n !== null);

    return { blocos, corretos, tentativas: 0, criado_em: new Date().toISOString() };
  }

  throw new Error("Não foi possível gerar uma combinação de desafio inédita após várias tentativas.");
}

export function formatarMensagemDesafio(desafio: Desafio): string {
  const linhas = desafio.blocos.map((b, i) => `${i + 1}) ${b.join("  ")}`);
  return (
    "🔐 *Verificação de segurança*\n\n" +
    "Selecione o(s) bloco(s) que contenha(m) ao menos 1 letra da sua palavra-chave:\n\n" +
    linhas.join("\n") +
    '\n\nResponda com os números dos blocos, separados por vírgula (ex.: "1,3").'
  );
}

/** Extrai números 1-4 da resposta do médico. Retorna null se não achar nada aproveitável. */
export function extrairBlocosDaResposta(texto: string): number[] | null {
  const numeros = Array.from(new Set((texto.match(/[1-4]/g) || []).map(Number)));
  if (numeros.length === 0) return null;
  return numeros.sort((a, b) => a - b);
}

export function respostaEstaCorreta(desafio: Desafio, blocosEscolhidos: number[]): boolean {
  const esperado = [...desafio.corretos].sort((a, b) => a - b);
  const recebido = [...blocosEscolhidos].sort((a, b) => a - b);
  return esperado.length === recebido.length && esperado.every((v, i) => v === recebido[i]);
}

export function diasDesde(dataISO: string | null | undefined): number | null {
  if (!dataISO) return null;
  const ms = Date.now() - new Date(dataISO).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export type StatusRotacao = {
  diasDesdeCriacao: number | null;
  precisaTrocarAgora: boolean; // 90 dias ou 30 usos — bloqueia até trocar
  avisoTrocaEmBreve: boolean; // 60 dias ou 25 usos — só notifica no app
};

export function calcularStatusRotacao(criadaEmISO: string | null | undefined, usos: number): StatusRotacao {
  const dias = diasDesde(criadaEmISO);
  const precisaTrocarAgora = (dias !== null && dias >= ROTACAO_DIAS_OBRIGATORIA) || usos >= ROTACAO_USOS_OBRIGATORIA;
  const avisoTrocaEmBreve =
    !precisaTrocarAgora &&
    ((dias !== null && dias >= ROTACAO_DIAS_AVISO) || usos >= ROTACAO_USOS_AVISO);
  return { diasDesdeCriacao: dias, precisaTrocarAgora, avisoTrocaEmBreve };
}
