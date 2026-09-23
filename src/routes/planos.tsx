import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
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

import { ChatSuporte } from "@/components/suporte/ChatSuporte";
import { salvarPedido } from "@/lib/contratacao/pedido";
import {
  DESCONTO_ANUAL,
  MAX_MEDICOS,
  MAX_SECRETARIAS,
  PERSONALIZADO,
  PLANOS_BASE,
  PLANO_PADRAO,
  PRECO_MEDICO_ADICIONAL,
  PRECO_SECRETARIA_ADICIONAL,
  TIERS_COPILOTO,
  TIERS_VIDEO,
  TIERS_WHATSAPP,
  WHATSAPP_COMERCIAL,
  configuracaoDoPlano,
  configuracaoIgualAncora,
  descontoPercentualDoPlano,
  formatarPreco,
  opcoesComPersonalizado,
  possuiItemPersonalizado,
  precoALaCarteDoPlano,
  precoAnualEquivalenteMensal,
  precoDaConfiguracao,
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

type SugestaoPlano = {
  alvo: (typeof PLANOS_BASE)[number];
  direcao: "menor" | "maior";
  /** preço do alvo (no ciclo atual) menos o preço atual exibido — positivo = alvo é mais caro. */
  diferenca: number;
  beneficios?: string[];
  aoConfirmar: () => void;
  aoContinuar: () => void;
};

/** O que o plano `alvo` tem de sobra em relação à configuração `atual`, em texto pronto pra lista. */
function listarBeneficiosExtras(atual: ConfiguracaoPlano, alvo: (typeof PLANOS_BASE)[number]): string[] {
  const itens: string[] = [];
  if (alvo.medicos > atual.medicos) {
    const diff = alvo.medicos - atual.medicos;
    itens.push(`+${diff} médico${diff > 1 ? "s" : ""}`);
  }
  if (alvo.secretarias > atual.secretarias) {
    const diff = alvo.secretarias - atual.secretarias;
    itens.push(`+${diff} usuário${diff > 1 ? "s" : ""} de gestão`);
  }
  if (atual.copiloto !== PERSONALIZADO && alvo.copiloto > atual.copiloto) {
    itens.push(`+${(alvo.copiloto - atual.copiloto).toLocaleString("pt-BR")} consultas de Copiloto`);
  }
  if (atual.whatsapp !== PERSONALIZADO && alvo.whatsapp > atual.whatsapp) {
    itens.push(`+${(alvo.whatsapp - atual.whatsapp).toLocaleString("pt-BR")} conversas de WhatsApp`);
  }
  if (atual.video !== PERSONALIZADO) {
    if (atual.video === 0 && alvo.video > 0) {
      itens.push(`Vídeo incluído (${alvo.video.toLocaleString("pt-BR")} min)`);
    } else if (alvo.video > atual.video) {
      itens.push(`+${(alvo.video - atual.video).toLocaleString("pt-BR")} min de vídeo`);
    }
  }
  return itens;
}

function PaginaPlanos() {
  const navigate = useNavigate();

  const [ancoraId, setAncoraId] = useState<PlanoBaseId>("pro");
  const [config, setConfig] = useState<ConfiguracaoPlano>(
    configuracaoDoPlano(PLANOS_BASE.find((p) => p.id === "pro") ?? PLANO_PADRAO),
  );
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [jaEscolheu, setJaEscolheu] = useState(true);
  const [rolado, setRolado] = useState(false);
  const [modal, setModal] = useState<SugestaoPlano | null>(null);

  const configuradorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function aoRolar() {
      setRolado(window.scrollY > 140);
    }
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  const ancora = PLANOS_BASE.find((p) => p.id === ancoraId) ?? PLANO_PADRAO;
  const ajustado = !configuracaoIgualAncora(config, ancora);
  const precisaCotacao = possuiItemPersonalizado(config);
  const indiceAncora = PLANOS_BASE.findIndex((p) => p.id === ancoraId);
  const planoProximo = indiceAncora >= 0 && indiceAncora < PLANOS_BASE.length - 1 ? PLANOS_BASE[indiceAncora + 1] : null;
  const planoAnterior = indiceAncora > 0 ? PLANOS_BASE[indiceAncora - 1] : null;

  const precoMensal = precoDaConfiguracao(config, ancora);
  const precoExibido = ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  function precoDoPlanoExibido(plano: (typeof PLANOS_BASE)[number]): number {
    return ciclo === "anual" ? precoAnualEquivalenteMensal(plano.precoMensal) : plano.precoMensal;
  }

  function escolherPlanoPronto(id: PlanoBaseId) {
    const plano = PLANOS_BASE.find((p) => p.id === id);
    if (!plano) return;
    setAncoraId(id);
    setConfig(configuracaoDoPlano(plano));
    setJaEscolheu(true);
    setModal(null);
    // Rola até o detalhamento da configuração escolhida.
    requestAnimationFrame(() => {
      configuradorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function atualizarConfig(mudanca: Partial<ConfiguracaoPlano>) {
    setJaEscolheu(true);
    setConfig((atual) => ({ ...atual, ...mudanca }));
  }

  /** Médicos/secretárias (licenças): se o novo valor já alcança o mínimo de um plano maior, sugere migrar pra ele. */
  function mudarLicenca(campo: "medicos" | "secretarias", valor: number) {
    atualizarConfig({ [campo]: valor });
    const candidato = PLANOS_BASE.slice(indiceAncora + 1).find((p) => p[campo] > ancora[campo] && valor >= p[campo]);
    if (!candidato) return;
    const novoConfigParcial = { ...config, [campo]: valor };
    const beneficios = listarBeneficiosExtras(novoConfigParcial, candidato);
    if (beneficios.length === 0) return;
    setModal({
      alvo: candidato,
      direcao: "maior",
      diferenca: precoDoPlanoExibido(candidato) - precoDaConfiguracao(novoConfigParcial, ancora),
      beneficios,
      aoConfirmar: () => escolherPlanoPronto(candidato.id),
      aoContinuar: () => setModal(null),
    });
  }

  /** Chip de franquia abaixo do mínimo do plano atual: bloqueia e sugere o plano anterior, que já cobre esse valor de fábrica. */
  function sugerirPlanoInferior() {
    if (!planoAnterior) return;
    setModal({
      alvo: planoAnterior,
      direcao: "menor",
      diferenca: precoExibido - precoDoPlanoExibido(planoAnterior),
      aoConfirmar: () => escolherPlanoPronto(planoAnterior.id),
      aoContinuar: () => setModal(null),
    });
  }

  function irParaPagamento() {
    if (!precisaCotacao && planoProximo) {
      const beneficios = listarBeneficiosExtras(config, planoProximo);
      if (beneficios.length > 0) {
        setModal({
          alvo: planoProximo,
          direcao: "maior",
          diferenca: precoDoPlanoExibido(planoProximo) - precoExibido,
          beneficios,
          aoConfirmar: () => {
            const novoConfig = configuracaoDoPlano(planoProximo);
            salvarPedido({ plano: planoProximo.id, config: novoConfig, ciclo });
            setAncoraId(planoProximo.id);
            setConfig(novoConfig);
            setModal(null);
            navigate({ to: "/contratacao/confirmar" });
          },
          aoContinuar: () => {
            setModal(null);
            confirmarPagamento();
          },
        });
        return;
      }
    }
    confirmarPagamento();
  }

  function confirmarPagamento() {
    salvarPedido({ plano: ancora.id, config, ciclo });
    navigate({ to: "/contratacao/confirmar" });
  }

  const resumoWhatsApp = useMemo(() => {
    const texto = [
      precisaCotacao
        ? `Olá! Quero uma cotação personalizada do MediCopilot.`
        : `Olá! Quero contratar o MediCopilot.`,
      `Plano: ${ancora.nome}${ajustado ? " (personalizado)" : ""}`,
      `Médicos: ${config.medicos}`,
      `Secretárias/Gestão: ${config.secretarias}`,
      `Copiloto IA: ${config.copiloto === PERSONALIZADO ? "personalizado (sob consulta)" : `${config.copiloto} consultas`}`,
      `WhatsApp: ${config.whatsapp === PERSONALIZADO ? "personalizado (sob consulta)" : `${config.whatsapp} conversas`}`,
      `Vídeo: ${
        config.video === PERSONALIZADO
          ? "personalizado (sob consulta)"
          : config.video
            ? `${config.video} minutos`
            : "não incluído"
      }`,
      `Ciclo: ${ciclo === "anual" ? "anual" : "mensal"}`,
      precisaCotacao ? `Total: sob consulta` : `Total estimado: ${formatarPreco(precoExibido)}/mês`,
    ].join("\n");
    return `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(texto)}`;
  }, [ancora, ajustado, config, ciclo, precoExibido, precisaCotacao]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#eef8f1_0%,#f3f1fb_45%,#fdf6ec_100%)]">
      <Blobs />

      {/* Balãozinho flutuante com o toggle mensal/anual, some no topo até rolar a tela */}
      <div
        className={[
          "fixed inset-x-0 top-4 z-40 flex justify-center transition-all duration-300",
          rolado ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
        ].join(" ")}
      >
        <div className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/95 p-1 shadow-lg shadow-slate-300/40 backdrop-blur-xl">
          <CicloButton ativo={ciclo === "mensal"} onClick={() => setCiclo("mensal")}>
            Mensal
          </CicloButton>
          <CicloButton ativo={ciclo === "anual"} onClick={() => setCiclo("anual")}>
            Anual
            <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              -{Math.round(DESCONTO_ANUAL * 100)}%
            </span>
          </CicloButton>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-44 pt-14 md:px-8 md:pt-20">
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
              const ativo = ancoraId === plano.id;
              const preco =
                ciclo === "anual" ? precoAnualEquivalenteMensal(plano.precoMensal) : plano.precoMensal;
              const descontoPct = descontoPercentualDoPlano(plano);
              const precoALaCarte =
                ciclo === "anual"
                  ? precoAnualEquivalenteMensal(precoALaCarteDoPlano(plano))
                  : precoALaCarteDoPlano(plano);
              return (
                <div
                  key={plano.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => escolherPlanoPronto(plano.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      escolherPlanoPronto(plano.id);
                    }
                  }}
                  style={{ borderRadius: "32px" }}
                  className={[
                    "relative flex cursor-pointer flex-col p-7 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-2xl",
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
                    {descontoPct > 0.01 && (
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm text-slate-400 line-through">{formatarPreco(precoALaCarte)}</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          -{Math.round(descontoPct * 100)}% vs. plano Basic
                        </span>
                      </div>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      escolherPlanoPronto(plano.id);
                    }}
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
        <div ref={configuradorRef} className="mt-14 scroll-mt-6 grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="space-y-6 lg:col-span-2">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 text-emerald-600">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-semibold">
                  {ajustado ? `${ancora.nome}, do seu jeito` : "Monte seu próprio plano"}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Precisa de mais usuários ou mais consumo? Ajuste conforme a realidade da sua clínica —
                cada mudança soma (ou desconta) do valor mensal na hora.
              </p>
            </div>

            <SectionCard icon={Users} accent="emerald" titulo="Sua equipe">
              <ContadorLinha
                icon={Stethoscope}
                titulo="Médicos"
                subtitulo="Usuários que atendem pacientes"
                valor={config.medicos}
                min={ancora.medicos}
                max={MAX_MEDICOS}
                onChange={(v) => mudarLicenca("medicos", v)}
              />
              <ContadorLinha
                icon={UserRound}
                titulo="Secretárias / Gestão"
                subtitulo="Usuários administrativos"
                valor={config.secretarias}
                min={ancora.secretarias}
                max={MAX_SECRETARIAS}
                onChange={(v) => mudarLicenca("secretarias", v)}
              />
              <p className="pt-1 text-xs text-slate-400">
                Médico adicional: +{formatarPreco(PRECO_MEDICO_ADICIONAL)}/mês · Secretária adicional: +
                {formatarPreco(PRECO_SECRETARIA_ADICIONAL)}/mês
              </p>
            </SectionCard>

            <SectionCard
              icon={Bot}
              accent="violet"
              titulo="Copiloto IA"
              subtitulo="Sugestões clínicas, organização do prontuário, comandos durante a consulta e geração de condutas."
            >
              <SeletorTier
                opcoes={opcoesComPersonalizado(TIERS_COPILOTO, !!ancora.personalizavel)}
                valor={config.copiloto}
                accent="violet"
                sufixo="consultas"
                minimoIncluido={ancora.copiloto}
                onChange={(v) => atualizarConfig({ copiloto: v })}
                onAbaixoDoMinimo={sugerirPlanoInferior}
              />
            </SectionCard>

            <SectionCard
              icon={MessageCircle}
              accent="sky"
              titulo="WhatsApp"
              subtitulo="Atendimento, confirmações, mensagens automáticas e comunicação com pacientes."
            >
              <SeletorTier
                opcoes={opcoesComPersonalizado(TIERS_WHATSAPP, !!ancora.personalizavel)}
                valor={config.whatsapp}
                accent="sky"
                sufixo="conversas"
                minimoIncluido={ancora.whatsapp}
                onChange={(v) => atualizarConfig({ whatsapp: v })}
                onAbaixoDoMinimo={sugerirPlanoInferior}
              />
            </SectionCard>

            <SectionCard icon={Video} accent="amber" titulo="Vídeo" subtitulo="Teleconsultas diretamente pelo sistema.">
              <SeletorTier
                opcoes={opcoesComPersonalizado(TIERS_VIDEO, !!ancora.personalizavel)}
                valor={config.video}
                accent="amber"
                sufixo="min"
                minimoIncluido={ancora.video}
                onChange={(v) => atualizarConfig({ video: v })}
                onAbaixoDoMinimo={sugerirPlanoInferior}
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
            <div className="mt-1 flex items-center gap-2">
              <h3 className="text-xl font-bold text-slate-800">{ancora.nome}</h3>
              {ajustado && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                  personalizado
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <LinhaResumo label={`${config.medicos} médico${config.medicos > 1 ? "s" : ""}`} />
              <LinhaResumo
                label={`${config.secretarias} secretária${config.secretarias !== 1 ? "s" : ""} / gestão`}
              />
              <LinhaResumo
                label={`Copiloto · ${config.copiloto === PERSONALIZADO ? "personalizado (sob consulta)" : `${config.copiloto} consultas`}`}
              />
              <LinhaResumo
                label={`WhatsApp · ${config.whatsapp === PERSONALIZADO ? "personalizado (sob consulta)" : `${config.whatsapp.toLocaleString("pt-BR")} conversas`}`}
              />
              <LinhaResumo
                label={`Vídeo · ${
                  config.video === PERSONALIZADO
                    ? "personalizado (sob consulta)"
                    : config.video
                      ? `${config.video.toLocaleString("pt-BR")} min`
                      : "não incluído"
                }`}
              />
            </div>

            <div className="my-5 h-px bg-slate-200/70" />

            {precisaCotacao ? (
              <>
                <p className="text-xs text-slate-400">Total</p>
                <p className="text-2xl font-bold text-slate-800">Sob consulta</p>
                <p className="mt-1 text-xs text-slate-400">
                  Um ou mais itens foi marcado como personalizado — nosso time monta o valor com você.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}

            {precisaCotacao ? (
              <a
                href={resumoWhatsApp}
                target="_blank"
                rel="noreferrer"
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
              >
                Falar com nosso especialista
              </a>
            ) : (
              <>
                <button
                  onClick={irParaPagamento}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
                >
                  Ir para pagamento
                </button>
                <a
                  href={resumoWhatsApp}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100/80"
                >
                  Falar no WhatsApp
                </a>
              </>
            )}

            <p className="mt-3 text-center text-xs text-slate-400">
              {precisaCotacao
                ? "Itens personalizados entram em uma cotação com nosso time."
                : "Pagamento recorrente no cartão de crédito. Você pode alterar seu plano depois."}
            </p>
          </div>
        </div>
      </div>

      {/* Balão flutuante — aparece assim que a pessoa começa a escolher/ajustar */}
      <div
        className={[
          "pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 transition-all duration-300",
          jaEscolheu ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        ].join(" ")}
      >
        <div
          className="pointer-events-auto flex items-center gap-4 rounded-full border border-white/80 bg-white/80 py-2.5 pl-6 pr-2.5 shadow-2xl shadow-slate-300/50 backdrop-blur-xl"
        >
          <div className="text-sm">
            {precisaCotacao ? (
              <span className="font-bold text-slate-800">Sob consulta</span>
            ) : (
              <>
                <span className="font-bold text-slate-800">{formatarPreco(precoExibido)}</span>
                <span className="text-slate-400">/mês</span>
              </>
            )}
          </div>
          {precisaCotacao ? (
            <a
              href={resumoWhatsApp}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-colors hover:from-emerald-600 hover:to-emerald-700"
            >
              Falar com nosso especialista
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <button
              onClick={irParaPagamento}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-colors hover:from-emerald-600 hover:to-emerald-700"
            >
              Ir para pagamento
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <ChatSuporte />

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
          onClick={modal.aoContinuar}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ borderRadius: "28px" }}
            className="w-full max-w-sm border border-white/80 bg-white/95 p-6 shadow-2xl backdrop-blur-xl"
          >
            <h3 className="text-lg font-bold text-slate-800">
              {modal.direcao === "menor"
                ? `Isso já é o plano ${modal.alvo.nome}`
                : modal.diferenca > 0
                  ? `Por mais ${formatarPreco(modal.diferenca)}/mês você tem mais`
                  : `O plano ${modal.alvo.nome} sai mais em conta`}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {modal.direcao === "menor"
                ? `Essa configuração já é exatamente o plano ${modal.alvo.nome}, por ${formatarPreco(precoDoPlanoExibido(modal.alvo))}/mês — sem precisar montar à la carte. Quer trocar pra ele?`
                : `Migrando para o ${modal.alvo.nome} você garante:`}
            </p>
            {modal.beneficios && modal.beneficios.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                {modal.beneficios.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={modal.aoConfirmar}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:from-emerald-600 hover:to-emerald-700"
              >
                Trocar para {modal.alvo.nome}
              </button>
              <button
                onClick={modal.aoContinuar}
                className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100"
              >
                {modal.direcao === "menor" ? "Manter como está" : "Continuar sem trocar"}
              </button>
            </div>
          </div>
        </div>
      )}
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
  minimoIncluido,
  onAbaixoDoMinimo,
}: {
  opcoes: { quantidade: number; preco: number; label?: string }[];
  valor: number;
  accent: Accent;
  sufixo: string;
  onChange: (v: number) => void;
  /** Quantidade mínima já incluída no plano atual — opções abaixo disso ficam apagadas. */
  minimoIncluido?: number;
  /** Chamado ao clicar numa opção apagada, no lugar de onChange. */
  onAbaixoDoMinimo?: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((opcao) => {
        const ativo = opcao.quantidade === valor;
        const abaixoDoMinimo =
          minimoIncluido !== undefined && opcao.quantidade !== PERSONALIZADO && opcao.quantidade < minimoIncluido;
        return (
          <button
            key={opcao.quantidade}
            onClick={() => (abaixoDoMinimo ? onAbaixoDoMinimo?.() : onChange(opcao.quantidade))}
            className={[
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              ativo
                ? `${ACCENT_SOLID[accent]} text-white shadow-sm`
                : abaixoDoMinimo
                  ? "border border-slate-100 bg-slate-50 text-slate-300 hover:bg-slate-50"
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
