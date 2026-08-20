import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Envio público de respostas de formulário (link /f/{id}).
// Toda a gravação acontece aqui no servidor: o cliente anônimo não tem
// permissão de escrita nas tabelas de respostas, o que impede injetar itens
// em respostas de outros pacientes.
const ItemSchema = z.object({
  pergunta_id: z.string().uuid(),
  valor_texto: z.string().max(4000).nullable().optional(),
  valor_opcoes: z.array(z.string().max(300)).max(50).nullable().optional(),
  valor_escala: z.number().int().min(0).max(100).nullable().optional(),
});

const BodySchema = z.object({
  questionario_id: z.string().uuid(),
  paciente_id: z.string().uuid().nullable().optional(),
  // Código de 4 dígitos enviado por email — obrigatório quando o formulário
  // exige autenticação por email (questionarios.exigir_auth_email).
  codigo: z.string().regex(/^\d{4}$/).optional(),
  // Campos do cadastro selecionados no construtor (ex.: name, cpf, telefone,
  // email, data_nascimento, ic_peso...) — ver CAMPO_CATALOG em f.$formId.tsx
  // e CAMPOS_CADASTRO em public/questionarios.js.
  campos: z.record(z.string(), z.string().max(2000)).optional(),
  itens: z.array(ItemSchema).max(200),
});

const onlyDigits = (v: string | null | undefined) => String(v || "").replace(/\D/g, "");

function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

type PerguntaRef = {
  id: string;
  enunciado: string;
  tipo: "texto" | "unica" | "multipla" | "escala";
  escala_label_min: string | null;
  escala_label_max: string | null;
};

type ItemGravado = {
  pergunta_id: string;
  valor_texto: string | null;
  valor_opcoes: string[] | null;
  valor_escala: number | null;
};

// Transforma as respostas — qualquer que seja o tipo de pergunta — num texto
// corrido legível, pra registrar no prontuário (campo "notas" de consulta).
function flattenRespostas(perguntas: PerguntaRef[], itens: ItemGravado[]): string {
  const porId = new Map(perguntas.map((p) => [p.id, p]));
  const linhas = itens
    .map((it) => {
      const p = porId.get(it.pergunta_id);
      if (!p) return null;
      let valor = "—";
      if (p.tipo === "escala") {
        valor = it.valor_escala != null ? String(it.valor_escala) : "—";
      } else if (p.tipo === "unica" || p.tipo === "multipla") {
        valor = it.valor_opcoes && it.valor_opcoes.length ? it.valor_opcoes.join(", ") : "—";
      } else {
        valor = it.valor_texto && it.valor_texto.trim() ? it.valor_texto.trim() : "—";
      }
      return `${p.enunciado}\n${valor}`;
    })
    .filter(Boolean);
  return linhas.join("\n\n");
}

// Mesma leitura das respostas, em pares pergunta/valor — usada na cópia
// enviada por email ao paciente.
function linhasRespostas(perguntas: PerguntaRef[], itens: ItemGravado[]): { pergunta: string; valor: string }[] {
  const porId = new Map(perguntas.map((p) => [p.id, p]));
  return itens.flatMap((it) => {
    const p = porId.get(it.pergunta_id);
    if (!p) return [];
    let valor = "—";
    if (p.tipo === "escala") valor = it.valor_escala != null ? String(it.valor_escala) : "—";
    else if (p.tipo === "unica" || p.tipo === "multipla") valor = it.valor_opcoes?.length ? it.valor_opcoes.join(", ") : "—";
    else valor = it.valor_texto?.trim() || "—";
    return [{ pergunta: p.enunciado, valor }];
  });
}

// Campos do cadastro que mapeiam direto pra colunas de "pacientes".
const COLUNAS_DIRETAS = [
  "data_nascimento",
  "sexo",
  "sus",
  "mae",
  "pai",
  "ocupacao",
  "convenio",
  "cep",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "dados_clinicos",
] as const;

// Campos estruturados de endereço — usados para montar o texto concatenado
// abaixo (ver buildEnderecoConcat).
const ENDERECO_CAMPOS = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"] as const;

// A tela de cadastro (medicopilot.html) grava os campos de endereço separados
// (cep/logradouro/numero/...) E TAMBÉM um texto concatenado em "endereco" —
// é esse campo "endereco" que a listagem/ficha do paciente exibe (mapPatientRow
// só lê p.endereco, nunca os campos separados). Precisamos montar o mesmo
// texto aqui, ou o endereço preenchido pelo paciente no formulário fica
// gravado nas colunas separadas mas invisível na ficha do paciente.
// Mantém EXATAMENTE a mesma lógica de buildEnderecoConcat() do app principal.
function buildEnderecoConcat(a: Record<string, string | undefined>): string | null {
  let parte1 = [a.logradouro, a.numero].filter(Boolean).join(", ");
  if (a.complemento) parte1 = [parte1, a.complemento].filter(Boolean).join(" - ");
  let parte2 = [a.cidade, a.uf].filter(Boolean).join("/");
  if (a.bairro) parte2 = [a.bairro, parte2].filter(Boolean).join(", ");
  return [parte1, parte2].filter(Boolean).join(" - ") || null;
}

// Campos que mapeiam pra dentro de info_complementar (jsonb).
const INFO_COMPLEMENTAR_MAP: Record<string, string> = {
  ic_peso: "peso",
  ic_altura: "altura",
  ic_sangue: "sangue",
  ic_sedent: "sedent",
  ic_tab: "tab",
  ic_eti: "eti",
  ic_sono: "sono",
  ic_meds: "meds",
  ic_alerg: "alerg",
  ic_fam: "fam",
  ic_outros: "outros",
};

export const Route = createFileRoute("/api/public/formularios/responder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        const body = parsed.data;
        const campos = body.campos || {};

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: form, error: formErr } = await supabaseAdmin
            .from("questionarios")
            .select("id,ativo,anonimo,titulo,user_id,exigir_auth_email")
            .eq("id", body.questionario_id)
            .maybeSingle();
          if (formErr) throw formErr;
          if (!form || !form.ativo) return Response.json({ error: "form_unavailable" }, { status: 404 });

          // Só aceita itens de perguntas que pertencem a este formulário.
          const { data: perguntas, error: pErr } = await supabaseAdmin
            .from("questionario_perguntas")
            .select("id,enunciado,tipo,escala_label_min,escala_label_max")
            .eq("questionario_id", form.id);
          if (pErr) throw pErr;
          const perguntasRef = (perguntas || []) as PerguntaRef[];
          const validas = new Set(perguntasRef.map((p) => p.id));
          const itens = body.itens.filter((i) => validas.has(i.pergunta_id));

          const nome = (campos.name || "").trim();
          const telefone = onlyDigits(campos.telefone).slice(0, 20);
          const email = (campos.email || "").trim();
          const cpfDigits = onlyDigits(campos.cpf);
          const cpfFormatado = cpfDigits.length === 11 ? formatCpf(cpfDigits) : "";

          // Autenticação por email: valida o código antes de qualquer gravação.
          // emailVerificado fica gravado na própria resposta (não só no
          // formulário), pra exibir o selo "Assinado por..." mesmo se a
          // configuração do formulário for desligada depois.
          let emailVerificado = false;
          if (form.exigir_auth_email) {
            const emailNorm = email.toLowerCase();
            if (!emailNorm || !body.codigo) return Response.json({ error: "code_required" }, { status: 400 });
            const { data: registro, error: codErr } = await supabaseAdmin
              .from("questionario_email_codigos")
              .select("id,codigo,expira_em,tentativas,verificado")
              .eq("questionario_id", form.id)
              .eq("email", emailNorm)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (codErr) throw codErr;
            if (!registro) return Response.json({ error: "code_required" }, { status: 400 });
            if (registro.tentativas >= 6) return Response.json({ error: "code_blocked" }, { status: 429 });
            const expirado = new Date(registro.expira_em).getTime() < Date.now();
            if (registro.codigo !== body.codigo || expirado) {
              await supabaseAdmin
                .from("questionario_email_codigos")
                .update({ tentativas: registro.tentativas + 1 })
                .eq("id", registro.id);
              return Response.json({ error: expirado ? "code_expired" : "code_invalid" }, { status: 400 });
            }
            if (!registro.verificado) {
              await supabaseAdmin
                .from("questionario_email_codigos")
                .update({ verificado: true })
                .eq("id", registro.id);
            }
            emailVerificado = true;
          }

          // Cruza o CPF informado com os pacientes já cadastrados deste médico
          // (mesmo dono do formulário) — habilita ligar a resposta ao
          // paciente certo, mesmo quando o link foi enviado sem o parâmetro
          // ?p= (compartilhamento avulso/em massa, WhatsApp, impressão etc.).
          let pacienteIdResolvido: string | null = body.paciente_id || null;
          if (!form.anonimo && !pacienteIdResolvido && cpfDigits.length === 11) {
            const { data: pac, error: pacErr } = await supabaseAdmin
              .from("pacientes")
              .select("paciente_id")
              .eq("user_id", form.user_id)
              .or(`cpf.eq.${cpfFormatado},cpf.eq.${cpfDigits}`)
              .limit(1)
              .maybeSingle();
            if (pacErr) console.warn("[formularios:responder] falha ao buscar paciente por CPF", pacErr);
            if (pac) pacienteIdResolvido = pac.paciente_id;
          }

          // Monta os "extras" do cadastro (colunas diretas + info_complementar)
          // a partir dos campos que o médico configurou pro formulário.
          const colunasExtras: Record<string, string> = {};
          for (const col of COLUNAS_DIRETAS) if (campos[col]) colunasExtras[col] = campos[col];
          const infoComplementarExtras: Record<string, string> = {};
          for (const [campoId, chave] of Object.entries(INFO_COMPLEMENTAR_MAP)) {
            if (campos[campoId]) infoComplementarExtras[chave] = campos[campoId];
          }

          if (!form.anonimo && !pacienteIdResolvido && nome && cpfDigits.length === 11) {
            // CPF não corresponde a nenhum paciente cadastrado: cria um novo
            // cadastro com todos os dados informados no formulário.
            const enderecoNovo = buildEnderecoConcat(colunasExtras);
            const { data: novoPaciente, error: novoErr } = await supabaseAdmin
              .from("pacientes")
              .insert({
                name: nome,
                cpf: cpfFormatado,
                telefone: telefone || null,
                email: email || null,
                convenio: colunasExtras.convenio || "Particular",
                user_id: form.user_id,
                ...colunasExtras,
                ...(enderecoNovo ? { endereco: enderecoNovo } : {}),
                ...(Object.keys(infoComplementarExtras).length ? { info_complementar: infoComplementarExtras } : {}),
              })
              .select("paciente_id")
              .single();
            if (novoErr) console.warn("[formularios:responder] falha ao criar novo paciente", novoErr);
            else pacienteIdResolvido = novoPaciente.paciente_id;
          } else if (!form.anonimo && pacienteIdResolvido && (Object.keys(colunasExtras).length || Object.keys(infoComplementarExtras).length)) {
            // Paciente já existe: completa só o que estiver em branco no
            // cadastro — nunca sobrescreve dado já preenchido pela clínica.
            try {
              const { data: existente } = await supabaseAdmin
                .from("pacientes")
                .select([...COLUNAS_DIRETAS, "endereco", "info_complementar"].join(","))
                .eq("paciente_id", pacienteIdResolvido)
                .maybeSingle();
              if (existente) {
                const ex = existente as unknown as Record<string, unknown>;
                const updateCols: Record<string, string> = {};
                for (const col of COLUNAS_DIRETAS) {
                  if (colunasExtras[col] && !ex[col]) updateCols[col] = colunasExtras[col];
                }
                // "endereco" é o texto concatenado que a ficha do paciente
                // exibe (ver comentário em buildEnderecoConcat). Só recalcula
                // se ainda estiver em branco no cadastro — nunca sobrescreve
                // um endereço já preenchido pela clínica — usando o valor
                // final de cada campo estruturado (o que acabou de ser
                // completado agora + o que já existia no cadastro).
                if (!ex.endereco) {
                  const enderecoAtualizado = buildEnderecoConcat(
                    Object.fromEntries(
                      ENDERECO_CAMPOS.map((c) => [c, (updateCols[c] as string | undefined) ?? (ex[c] as string | undefined)]),
                    ),
                  );
                  if (enderecoAtualizado) updateCols.endereco = enderecoAtualizado;
                }
                const infoAtual = (ex.info_complementar as Record<string, unknown>) || {};
                const infoMerge = { ...infoAtual };
                let infoMudou = false;
                for (const [chave, valor] of Object.entries(infoComplementarExtras)) {
                  if (!infoAtual[chave]) {
                    infoMerge[chave] = valor;
                    infoMudou = true;
                  }
                }
                if (Object.keys(updateCols).length || infoMudou) {
                  const { error: updErr } = await supabaseAdmin
                    .from("pacientes")
                    .update({ ...updateCols, ...(infoMudou ? { info_complementar: infoMerge as any } : {}) })
                    .eq("paciente_id", pacienteIdResolvido);
                  if (updErr) console.warn("[formularios:responder] falha ao completar cadastro do paciente", updErr);
                }
              }
            } catch (compErr) {
              console.warn("[formularios:responder] falha ao mesclar dados do paciente", compErr);
            }
          }

          const identificacao = form.anonimo
            ? {}
            : {
                paciente_id: pacienteIdResolvido,
                paciente_nome: nome || null,
                paciente_telefone: telefone || null,
                paciente_email: email || null,
                paciente_cpf: cpfDigits || null,
              };

          const { data: resp, error: rErr } = await supabaseAdmin
            .from("questionario_respostas")
            .insert({ questionario_id: form.id, ...identificacao, email_verificado: emailVerificado } as never)
            .select("id")
            .single();
          if (rErr) throw rErr;

          const itensGravados: ItemGravado[] = itens.map((i) => ({
            pergunta_id: i.pergunta_id,
            valor_texto: i.valor_texto ?? null,
            valor_opcoes: i.valor_opcoes ?? null,
            valor_escala: i.valor_escala ?? null,
          }));

          if (itensGravados.length) {
            const { error: iErr } = await supabaseAdmin
              .from("questionario_resposta_itens")
              .insert(itensGravados.map((i) => ({ resposta_id: resp.id, ...i })));
            if (iErr) throw iErr;
          }

          // Paciente identificado (por CPF ou já vinculado via ?p=): registra
          // no prontuário (consulta) e cria o evento de timeline com o link
          // "Ver resposta".
          if (!form.anonimo && pacienteIdResolvido) {
            try {
              const now = new Date();
              const dateStr = now.toLocaleDateString("pt-BR");
              const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const texto = flattenRespostas(perguntasRef, itensGravados) || "Sem respostas registradas.";

              const { error: consultaErr } = await supabaseAdmin.from("consulta").insert({
                paciente_id: pacienteIdResolvido,
                id_medico: form.user_id,
                started_at: now.toISOString(),
                ended_at: now.toISOString(),
                title: `Formulário respondido — ${form.titulo}`,
                acao: "Formulário",
                resumo: texto.slice(0, 200) + (texto.length > 200 ? "..." : ""),
                notas: texto,
              });
              if (consultaErr) console.warn("[formularios:responder] falha ao registrar no prontuário", consultaErr);

              const { error: tlErr } = await supabaseAdmin.from("timeline_events").insert({
                paciente_id: pacienteIdResolvido,
                user_id: form.user_id,
                event_date: dateStr,
                type: "questionario",
                icon: "ti-clipboard-list",
                title: `Formulário respondido — ${timeStr}`,
                sub: form.titulo,
                ref_type: "questionario_resposta",
                ref_id: resp.id,
              });
              if (tlErr) console.warn("[formularios:responder] falha ao registrar timeline", tlErr);

              // Marca o cadastro como atualizado para que o resumo do
              // prontuário usado pela IA (resumo_prontuario) seja
              // regenerado na próxima abertura do paciente — sem isso, o
              // resumo em cache (válido por até 60 dias) não refletiria as
              // respostas recém-chegadas.
              const { error: touchErr } = await supabaseAdmin
                .from("pacientes")
                .update({ updated_at: now.toISOString() })
                .eq("paciente_id", pacienteIdResolvido);
              if (touchErr) console.warn("[formularios:responder] falha ao atualizar timestamp do paciente", touchErr);
            } catch (linkErr) {
              // Nunca falha o envio da resposta do paciente por causa do
              // vínculo com o prontuário — a resposta já está salva.
              console.warn("[formularios:responder] falha ao vincular ao prontuário/timeline", linkErr);
            }
          }

          // Formulários com autenticação por email recebem a cópia das
          // respostas no email confirmado pelo paciente.
          if (form.exigir_auth_email && email) {
            try {
              const { sendEmail, respostasEmailHtml } = await import("@/lib/email/send.server");
              await sendEmail({
                to: email,
                subject: `Cópia das suas respostas — ${form.titulo}`,
                html: respostasEmailHtml(form.titulo, nome, linhasRespostas(perguntasRef, itensGravados)),
              });
            } catch (mailErr) {
              // A resposta já está salva — o envio da cópia não pode falhar o fluxo.
              console.warn("[formularios:responder] falha ao enviar cópia por email", mailErr);
            }
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[formularios:responder]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
