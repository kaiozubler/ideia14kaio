import { useState } from "react";
import { Loader2, Tag, X } from "lucide-react";

import type { RespostaCupom } from "@/lib/contratacao/api";
import type { CupomDoPedido } from "@/lib/contratacao/pedido";

/**
 * Campo de cupom: confere no servidor (por `aplicar`) e mostra o benefício.
 * `aplicar(null)` remove o cupom. Em /planos o campo já vem aberto; em
 * "Confirme seu plano" fica atrás do link "Tem um cupom de desconto?".
 */
export function CampoCupom({
  cupom,
  onChange,
  aplicar,
  pronto = true,
  sempreAberto = false,
}: {
  cupom: CupomDoPedido | undefined;
  onChange: (cupom: CupomDoPedido | null) => void;
  aplicar: (codigo: string | null) => Promise<RespostaCupom>;
  /** false enquanto ainda não dá para conferir (ex.: contratação sendo criada). */
  pronto?: boolean;
  sempreAberto?: boolean;
}) {
  const [aberto, setAberto] = useState(sempreAberto);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(novo: string | null) {
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    const r = await aplicar(novo);
    setEnviando(false);
    if ("erro" in r) return setErro(r.erro);
    onChange(r.cupom);
    if (r.cupom) {
      setCodigo("");
      setAberto(sempreAberto);
    }
  }

  if (cupom) {
    return (
      <div
        style={{ borderRadius: "16px" }}
        className="flex items-start gap-2.5 border border-emerald-200/80 bg-emerald-50/70 p-3 text-sm"
      >
        <Tag className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-emerald-800">
            Cupom <span className="font-mono tracking-wide">{cupom.codigo}</span> aplicado
          </p>
          <p className="text-emerald-700">{cupom.texto}</p>
        </div>
        <button
          type="button"
          onClick={() => enviar(null)}
          disabled={enviando}
          title="Remover cupom"
          className="rounded-full p-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
      >
        <Tag className="h-4 w-4" />
        Tem um cupom de desconto?
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (codigo.trim()) enviar(codigo.trim());
      }}
      className="space-y-1.5"
    >
      {sempreAberto && (
        <label
          htmlFor="campo-cupom"
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"
        >
          <Tag className="h-3.5 w-3.5" />
          Cupom de desconto
        </label>
      )}
      <div className="flex gap-2">
        <input
          id="campo-cupom"
          autoFocus={!sempreAberto}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/\s/g, ""))}
          placeholder="Digite o cupom"
          maxLength={40}
          aria-label="Cupom de desconto"
          style={{ borderRadius: "14px" }}
          className="min-w-0 flex-1 border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm tracking-wide text-slate-700 outline-none focus:border-emerald-300"
        />
        <button
          type="submit"
          disabled={!codigo.trim() || enviando || !pronto}
          style={{ borderRadius: "14px" }}
          className="bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
        </button>
      </div>
      {erro && <p className="text-xs text-rose-600">{erro}</p>}
      {!pronto && <p className="text-xs text-slate-400">Preparando sua contratação…</p>}
    </form>
  );
}
