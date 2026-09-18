import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  MessageCircle,
  Minus,
  Plus,
  Sparkles,
  Stethoscope,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import {
  CONFIG_PADRAO,
  DESCONTO_ANUAL,
  EQUIPE_INCLUIDA,
  MAX_MEDICOS,
  MAX_SECRETARIAS,
  PLANOS_BASE,
  PRECO_MEDICO_ADICIONAL,
  PRECO_SECRETARIA_ADICIONAL,
  TIERS_COPILOTO,
  TIERS_VIDEO,
  TIERS_WHATSAPP,
  WHATSAPP_COMERCIAL,
  calcularPrecoMensal,
  configuracaoDoPlano,
  formatarPreco,
  precoAnualEquivalenteMensal,
  type ConfiguracaoPlano,
  type PlanoBaseId,
} from "@/lib/plans/config";

export const Route = createFileRoute("/planos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Planos e preços | MediCopilot" },
      {
        name: "description",
        content:
          "Escolha um plano pronto ou monte a assinatura do jeito que a sua clínica precisa.",
      },
      { property: "og:title", content: "Planos e preços | MediCopilot" },
      {
        property: "og:description",
        content: "Escolha um plano pronto ou monte a assinatura do jeito que a sua clínica precisa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaginaPlanos,
});

type Ciclo = "mensal" | "anual";

function PaginaPlanos() {
  const [planoSelecionado, setPlanoSelecionado] = useState<PlanoBaseId | "custom">("basic");
  const [config, setConfig] = useState<ConfiguracaoPlano>(CONFIG_PADRAO);
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");

  const planoAtivo = PLANOS_BASE.find((p) => p.id === planoSelecionado);

  const precoMensal = planoAtivo ? planoAtivo.precoMensal : calcularPrecoMensal(config);
  const precoExibido = ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  function escolherPlanoPronto(id: PlanoBaseId) {
    const plano = PLANOS_BASE.find((p) => p.id === id);
    if (!plano) return;
    setPlanoSelecionado(id);
    setConfig(configuracaoDoPlano(plano));
  }

  function atualizarConfig(mudanca: Partial<ConfiguracaoPlano>) {
    setPlanoSelecionado("custom");
    setConfig((atual) => ({ ...atual, ...mudanca }));
  }

  function continuar() {
    toast.message("Finalização online chegando em breve", {
      description: "Por enquanto, fala com a gente pelo WhatsApp que fechamos o seu plano na hora.",
    });
  }

  const resumoWhatsApp = useMemo(() => {
    const nomePlano = planoAtivo ? planoAtivo.nome : "Personalizado";
    const texto = [
      `Olá! Quero contratar o MediCopilot.`,
      `Plano: ${nomePlano}`,
      `Médicos: ${config.medicos}`,
      `Secretárias/Gestão: ${config.secretarias}`,
      `Copiloto IA: ${config.copiloto} consultas`,
      `WhatsApp: ${config.whatsapp} conversas`,
      `Vídeo: ${config.video ? `${config.video} minutos` : "não incluído"}`,
      `Ciclo: ${ciclo === "anual" ? "anual" : "mensal"}`,
      `Total estimado: ${formatarPreco(precoExibido)}/mês`,
    ].join("\n");
    return `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(texto)}`;
  }, [planoAtivo, config, ciclo, precoExibido]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#eef8f1_0%,#f3f1fb_45%,#fdf6ec_100%)]">
      <Blobs />

      <div className="relative mx-auto max-w-6xl px-4 pb-32 pt-14 md:px-8 md:pt-20">
        {/* Cabeçalho */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-800 md:text-4xl">
            Escolha o plano ideal para sua clínica
          </h1>
          <p className="mt-3 text-slate-500">
            Comece com o essencial e personalize conforme sua necessidade.
          </p>

          <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/60 p-1 shadow-sm backdrop-blur-xl">
            <CicloButton ativo={ciclo === "mensal"} onClick={() => setCiclo("mensal")}>
              Pagamento mensal
            </CicloButton>
            <CicloButton ativo={ciclo === "anual"} onClick={() => setCiclo("anual")}>
              Pagamento anual
              <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                -{Math.round(DESCONTO_ANUAL * 100)}%
              </span>
            </CicloButton>
          </div>
        </div>

        {/* Planos prontos */}
        <div className="mt-14">
          <p className="mb-5 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
            Escolha como começar
          </p>
          <div className="grid gap-5 md:grid-cols-3">
            {PLANOS_BASE.map((plano) => {
              const ativo = planoSelecionado === plano.id;
              const preco =
                ciclo === "anual" ? precoAnualEquivalenteMensal(plano.precoMensal) : plano.precoMensal;
              return (
                <div
                  key={plano.id}
                  style={{ borderRadius: "32px" }}
                  className={[
                    "relative flex flex-col p-7 backdrop-blur-xl transition-all",
                    plano.destaque
                      ? "border-2 border-emerald-300/80 bg-white/70 shadow-xl shadow-emerald-200/40"
                      : "border border-white/80 bg-white/60 shadow-xl shadow-slate-200/40",
                    ativo ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-transparent" : "",
                  ].join(" ")}
                >
                  {plano.destaque && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow">
                      Mais escolhido
                    </span>
                  )}

                  <h3 className="text-lg font-bold text-slate-800">{plano.nome}</h3>
                  <p className="mt-1 text-sm text-slate-500">{plano.descricao}</p>

                  <div className="mt-5">
                    {plano.personalizavel && (
                      <span className="text-xs font-medium text-slate-400">a partir de</span>
                    )}
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-slate-800">{formatarPreco(preco)}</span>
                      <span className="text-sm text-slate-400">/mês</span>
                    </div>
                  </div>

                  <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-600">
                    <ItemPlano>
                      {plano.medicos} médico{plano.medicos > 1 ? "s" : ""}
                    </ItemPlano>
                    <ItemPlano>
                      {plano.secretarias} usuário{plano.secretarias > 1 ? "s" : ""} de gestão
                    </ItemPlano>
                    <ItemPlano>{plano.copiloto} consultas de Copiloto</ItemPlano>
                    <ItemPlano>{plano.whatsapp.toLocaleString("pt-BR")} conversas de WhatsApp</ItemPlano>
                    <ItemPlano>
                      {plano.video ? `${plano.video.toLocaleString("pt-BR")} min de vídeo` : "Vídeo não incluído"}
                    </ItemPlano>
                  </ul>

                  <button
                    onClick={() => escolherPlanoPronto(plano.id)}
                    className={[
                      "mt-6 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors",
                      plano.destaque
                        ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700"
                        : "bg-slate-800 text-white hover:bg-slate-900",
                    ].join(" ")}
                  >
                    {plano.personalizavel ? "Personalizar" : `Escolher ${plano.nome}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monte seu plano + resumo */}
        <div className="mt-14 grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="space-y-6 lg:col-span-2">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 text-emerald-600">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-semibold">Monte seu próprio plano</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Precisa de mais usuários ou mais consumo? Ajuste conforme a realidade da sua clínica —
                o valor é recalculado na hora.
              </p>
            </div>

            <SectionCard icon={Users} accent="emerald" titulo="Sua equipe">
              <ContadorLinha
                icon={Stethoscope}
                titulo="Médicos"
                subtitulo="Usuários que atendem pacientes"
                valor={config.medicos}
                min={EQUIPE_INCLUIDA.medicos}
                max={MAX_MEDICOS}
                onChange={(v) => atualizarConfig({ medicos: v })}
              />
              <ContadorLinha
                icon={UserRound}
                titulo="Secretárias / Gestão"
                subtitulo="Usuários administrativos"
                valor={config.secretarias}
                min={0}
                max={MAX_SECRETARIAS}
                onChange={(v) => atualizarConfig({ secretarias: v })}
              />
              <p className="pt-1 text-xs text-slate-400">
                Médico adicional: {formatarPreco(PRECO_MEDICO_ADICIONAL)}/mês · Secretária adicional:{" "}
                {formatarPreco(PRECO_SECRETARIA_ADICIONAL)}/mês
              </p>
            </SectionCard>

            <SectionCard icon={Bot} accent="violet" titulo="Copiloto IA" subtitulo="Sugestões clínicas, organização do prontuário, comandos durante a consulta e geração de condutas.">
              <SeletorTier
                opcoes={TIERS_COPILOTO}
                valor={config.copiloto}
                accent="violet"
                sufixo="consultas"
                onChange={(v) => atualizarConfig({ copiloto: v })}
              />
            </SectionCard>

            <SectionCard icon={MessageCircle} accent="sky" titulo="WhatsApp" subtitulo="Atendimento, confirmações, mensagens automáticas e comunicação com pacientes.">
              <SeletorTier
                opcoes={TIERS_WHATSAPP}
                valor={config.whatsapp}
                accent="sky"
                sufixo="conversas"
                onChange={(v) => atualizarConfig({ whatsapp: v })}
              />
            </SectionCard>

            <SectionCard icon={Video} accent="amber" titulo="Vídeo" subtitulo="Teleconsultas diretamente pelo sistema.">
              <SeletorTier
                opcoes={TIERS_VIDEO}
                valor={config.video}
                accent="amber"
                sufixo="min"
                onChange={(v) => atualizarConfig({ video: v })}
              />
            </SectionCard>

            <div
              style={{ borderRadius: "28px" }}
              className="border border-white/80 bg-white/50 p-6 backdrop-blur-xl"
            >
              <h4 className="text-sm font-bold text-slate-800">Como funcionam seus créditos?</h4>
              <div className="mt-3 space-y-2 text-sm text-slate-500">
                <p>
                  <span className="font-semibold text-slate-700">Copiloto IA</span> — cada consulta ao
                  Copiloto utiliza 1 crédito da sua franquia.
                </p>
                <p>
                  <span className="font-semibold text-slate-700">WhatsApp</span> — suas conversas são
                  contabilizadas dentro da franquia contratada.
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Vídeo</span> — os minutos usados são
                  descontados da franquia mensal.
                </p>
                <p className="text-xs text-slate-400">Você recebe novos créditos a cada renovação do plano.</p>
              </div>
            </div>
          </div>

          {/* Resumo */}
          <div
            style={{ borderRadius: "32px" }}
            className="border border-white/80 bg-white/70 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl lg:sticky lg:top-6"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Seu plano</p>
            <h3 className="mt-1 text-xl font-bold text-slate-800">
              {planoAtivo ? planoAtivo.nome : "Personalizado"}
            </h3>

            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <LinhaResumo label={`${config.medicos} médico${config.medicos > 1 ? "s" : ""}`} />
              <LinhaResumo
                label={`${config.secretarias} secretária${config.secretarias !== 1 ? "s" : ""} / gestão`}
              />
              <LinhaResumo label={`Copiloto · ${config.copiloto} consultas`} />
              <LinhaResumo label={`WhatsApp · ${config.whatsapp.toLocaleString("pt-BR")} conversas`} />
              <LinhaResumo
                label={config.video ? `Vídeo · ${config.video.toLocaleString("pt-BR")} min` : "Vídeo · não incluído"}
              />
            </div>

            <div className="my-5 h-px bg-slate-200/70" />

            <p className="text-xs text-slate-400">
              Total {ciclo === "anual" ? "mensal (cobrado anual)" : "mensal"}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-800">{formatarPreco(precoExibido)}</span>
              <span className="text-sm text-slate-400">/mês</span>
            </div>
            {ciclo === "anual" && (
              <p className="mt-1 text-xs text-emerald-600">
                {formatarPreco(precoExibido * 12)}/ano · economia de {Math.round(DESCONTO_ANUAL * 100)}%
              </p>
            )}

            <button
              onClick={continuar}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
            >
              Continuar
            </button>
            <a
              href={resumoWhatsApp}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100/80"
            >
              Falar no WhatsApp
            </a>

            <p className="mt-3 text-center text-xs text-slate-400">
              Pagamento recorrente no cartão de crédito. Você pode alterar seu plano depois.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function Blobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-emerald-200 opacity-60 blur-3xl" />
      <div className="absolute -right-24 top-40 h-96 w-96 rounded-full bg-violet-200 opacity-60 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-amber-200 opacity-50 blur-3xl" />
    </div>
  );
}

function CicloButton({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors",
        ativo ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ItemPlano({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      <span>{children}</span>
    </li>
  );
}

const ACCENTS = {
  emerald: "from-emerald-400 to-emerald-600",
  violet: "from-violet-400 to-violet-600",
  amber: "from-amber-400 to-orange-500",
  sky: "from-sky-400 to-blue-500",
} as const;

const ACCENT_SOLID = {
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
} as const;

type Accent = keyof typeof ACCENTS;

function SectionCard({
  icon: Icon,
  accent,
  titulo,
  subtitulo,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ borderRadius: "32px" }}
      className="border border-white/80 bg-white/60 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-8"
    >
      <div className="flex items-start gap-3">
        <div
          style={{ borderRadius: "18px" }}
          className={`flex h-12 w-12 shrink-0 items-center justify-center bg-gradient-to-br ${ACCENTS[accent]}`}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-slate-800">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ContadorLinha({
  icon: Icon,
  titulo,
  subtitulo,
  valor,
  min,
  max,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  subtitulo: string;
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200/60 py-4 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-sm font-semibold text-slate-700">{titulo}</p>
          <p className="text-xs text-slate-400">{subtitulo}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(min, valor - 1))}
          disabled={valor <= min}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-sm font-bold text-slate-800">{valor}</span>
        <button
          onClick={() => onChange(Math.min(max, valor + 1))}
          disabled={valor >= max}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SeletorTier({
  opcoes,
  valor,
  accent,
  sufixo,
  onChange,
}: {
  opcoes: { quantidade: number; preco: number; label?: string }[];
  valor: number;
  accent: Accent;
  sufixo: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((opcao) => {
        const ativo = opcao.quantidade === valor;
        return (
          <button
            key={opcao.quantidade}
            onClick={() => onChange(opcao.quantidade)}
            className={[
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              ativo
                ? `${ACCENT_SOLID[accent]} text-white shadow-sm`
                : "border border-slate-200 bg-white/70 text-slate-600 hover:bg-white",
            ].join(" ")}
          >
            {opcao.label ?? `${opcao.quantidade.toLocaleString("pt-BR")} ${sufixo}`}
          </button>
        );
      })}
    </div>
  );
}

function LinhaResumo({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
