import { createFileRoute, Link } from "@tanstack/react-router";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";
import { z } from "zod";

import {
  PLANOS_BASE,
  PLANO_PADRAO,
  WHATSAPP_COMERCIAL,
  configuracaoIgualAncora,
  formatarPreco,
  precoAnualEquivalenteMensal,
  precoDaConfiguracao,
} from "@/lib/plans/config";

const checkoutSearchSchema = z.object({
  plano: z.enum(["basic", "pro", "enterprise"]).catch(PLANO_PADRAO.id),
  medicos: z.coerce.number().int().min(0).catch(PLANO_PADRAO.medicos),
  secretarias: z.coerce.number().int().min(0).catch(PLANO_PADRAO.secretarias),
  copiloto: z.coerce.number().int().min(0).catch(PLANO_PADRAO.copiloto),
  whatsapp: z.coerce.number().int().min(0).catch(PLANO_PADRAO.whatsapp),
  video: z.coerce.number().int().min(0).catch(PLANO_PADRAO.video),
  ciclo: z.enum(["mensal", "anual"]).catch("mensal"),
});

export const Route = createFileRoute("/checkout")({
  ssr: false,
  validateSearch: checkoutSearchSchema,
  head: () => ({
    meta: [
      { title: "Pagamento | MediCopilot" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PaginaCheckout,
});

function PaginaCheckout() {
  const busca = Route.useSearch();

  const ancora = PLANOS_BASE.find((p) => p.id === busca.plano) ?? PLANO_PADRAO;
  const config = {
    medicos: busca.medicos,
    secretarias: busca.secretarias,
    copiloto: busca.copiloto,
    whatsapp: busca.whatsapp,
    video: busca.video,
  };
  const ajustado = !configuracaoIgualAncora(config, ancora);

  const precoMensal = precoDaConfiguracao(config, ancora);
  const precoExibido = busca.ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  const resumoWhatsApp = (() => {
    const texto = [
      `Olá! Quero fechar a contratação do MediCopilot.`,
      `Plano: ${ancora.nome}${ajustado ? " (personalizado)" : ""}`,
      `Médicos: ${config.medicos}`,
      `Secretárias/Gestão: ${config.secretarias}`,
      `Copiloto IA: ${config.copiloto} consultas`,
      `WhatsApp: ${config.whatsapp} conversas`,
      `Vídeo: ${config.video ? `${config.video} minutos` : "não incluído"}`,
      `Ciclo: ${busca.ciclo === "anual" ? "anual" : "mensal"}`,
      `Total: ${formatarPreco(precoExibido)}/mês`,
    ].join("\n");
    return `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(texto)}`;
  })();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#eef8f1_0%,#f3f1fb_45%,#fdf6ec_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-emerald-200 opacity-60 blur-3xl" />
        <div className="absolute -right-24 top-40 h-96 w-96 rounded-full bg-violet-200 opacity-60 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-14 md:px-8 md:py-20">
        <Link to="/planos" className="text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Voltar para planos
        </Link>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Finalizar contratação</h1>
        <p className="mt-1 text-sm text-slate-500">Confira seu plano antes de continuar.</p>

        <div className="mt-8 grid gap-6 md:grid-cols-5">
          {/* Resumo do pedido */}
          <div
            style={{ borderRadius: "28px" }}
            className="border border-white/80 bg-white/70 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:col-span-2 md:order-2"
          >
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Seu pedido</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-800">{ancora.nome}</h3>
              {ajustado && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                  personalizado
                </span>
              )}
            </div>

            <div className="mt-4 space-y-1.5 text-sm text-slate-600">
              <p>{config.medicos} médico{config.medicos !== 1 ? "s" : ""}</p>
              <p>{config.secretarias} secretária{config.secretarias !== 1 ? "s" : ""} / gestão</p>
              <p>Copiloto · {config.copiloto} consultas</p>
              <p>WhatsApp · {config.whatsapp.toLocaleString("pt-BR")} conversas</p>
              <p>{config.video ? `Vídeo · ${config.video.toLocaleString("pt-BR")} min` : "Vídeo · não incluído"}</p>
            </div>

            <div className="my-4 h-px bg-slate-200/70" />

            <p className="text-xs text-slate-400">
              Total {busca.ciclo === "anual" ? "mensal (cobrado anual)" : "mensal"}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-slate-800">{formatarPreco(precoExibido)}</span>
              <span className="text-sm text-slate-400">/mês</span>
            </div>
          </div>

          {/* Pagamento */}
          <div
            style={{ borderRadius: "28px" }}
            className="border border-white/80 bg-white/60 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:col-span-3 md:order-1"
          >
            <div className="flex items-center gap-2">
              <div
                style={{ borderRadius: "14px" }}
                className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600"
              >
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Cartão de crédito</h3>
                <p className="text-xs text-slate-400">Cobrança recorrente mensal</p>
              </div>
            </div>

            <div className="mt-6 space-y-3 opacity-60">
              <div
                style={{ borderRadius: "16px" }}
                className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400"
              >
                Número do cartão
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div
                  style={{ borderRadius: "16px" }}
                  className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400"
                >
                  Validade
                </div>
                <div
                  style={{ borderRadius: "16px" }}
                  className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400"
                >
                  CVV
                </div>
              </div>
            </div>

            <div
              style={{ borderRadius: "18px" }}
              className="mt-5 flex items-start gap-3 border border-amber-200/70 bg-amber-50/70 p-4"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">
                O pagamento online ainda está a caminho. Por enquanto, a gente fecha sua assinatura
                pessoalmente pelo WhatsApp — leva menos de 5 minutos.
              </p>
            </div>

            <a
              href={resumoWhatsApp}
              target="_blank"
              rel="noreferrer"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
            >
              Falar no WhatsApp e fechar meu plano
            </a>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Seus dados de pagamento nunca são armazenados por nós diretamente.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
