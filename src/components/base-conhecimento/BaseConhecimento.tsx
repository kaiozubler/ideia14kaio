// @ts-nocheck
//
// Protótipo de UI da tela "Base de Conhecimento" (menu Minhas IAs, abaixo de
// Copiloto). Segue o design system "liquid glass" do produto.
//
// Este componente ainda usa estado local (window.storage) só pra demonstrar
// o comportamento — para produção, trocar as leituras/escritas por chamadas
// a /api/base-conhecimento/bases, /itens e /atalhos (ver src/routes/api/base-conhecimento).
// Como este repositório não contém o app shell (sidebar/menu "Minhas IAs"),
// esse componente precisa ser importado e roteado a partir do projeto onde o
// menu de fato vive.
import React, { useState, useEffect, useRef } from "react";
import {
  Database, BookOpen, Upload, FileText, Trash2, Plus, ChevronDown,
  Zap, Info, Check, Bot, MessageSquare, Tag, X, Loader2, FileUp,
  AlertCircle, CircleCheck,
} from "lucide-react";

/* ---------- design tokens (liquid-glass-ui) ---------- */
const card = "relative bg-white/60 backdrop-blur-xl border border-white/80 shadow-xl shadow-slate-200/40 p-6 md:p-8";
const cardRadius = { borderRadius: "32px" };
const iconBoxRadius = { borderRadius: "18px" };
const inputCls =
  "w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-slate-200 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all";
const pageFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, sans-serif';
const pageBackground = "linear-gradient(135deg, #eef8f1 0%, #f3f1fb 45%, #fdf6ec 100%)";

function Blob({ className, style }) {
  return <div aria-hidden className={`absolute rounded-full blur-3xl opacity-60 pointer-events-none ${className}`} style={style} />;
}

function Toggle({ checked, onChange, color = "emerald" }) {
  const bg = checked ? (color === "violet" ? "bg-violet-500" : "bg-emerald-500") : "bg-slate-300";
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange}
      className={`relative w-11 h-6.5 h-7 rounded-full transition-colors duration-200 shrink-0 ${bg}`}>
      <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Chip({ active, onClick, children, color = "emerald" }) {
  const palette = {
    emerald: active ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white/70 border-slate-200 text-slate-600 hover:border-emerald-300",
    violet: active ? "bg-violet-500 border-violet-500 text-white" : "bg-white/70 border-slate-200 text-slate-600 hover:border-violet-300",
    amber: active ? "bg-amber-500 border-amber-500 text-white" : "bg-white/70 border-slate-200 text-slate-600 hover:border-amber-300",
  };
  return (
    <button type="button" onClick={onClick} className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${palette[color]}`}>
      {children}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const estimateTokens = (text) => Math.max(1, Math.round((text || "").length / 4));
const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

const IA_OPTIONS = [
  { id: "chat_ai", label: "Chat IA", icon: MessageSquare, color: "emerald" },
  { id: "assistente_ai", label: "Assistente IA", icon: Bot, color: "violet" },
];

const DEFAULT_BASES = [
  {
    id: uid(), nome: "Protocolo de Hipertensão da clínica", descricao: "Fluxo de conduta e metas de PA usados aqui na clínica, adaptado das diretrizes que seguimos.",
    tags: ["cardiologia", "protocolo"], ias: ["chat_ai", "assistente_ai"], ativo: true, status: "pronto",
    itens: [
      { id: uid(), tipo: "arquivo", nome: "protocolo-has-v3.pdf", tokens: 2200 },
      { id: uid(), tipo: "texto", nome: "Observação sobre titulação de dose", tokens: 180 },
    ],
  },
  {
    id: uid(), nome: "Modelo de laudo de retorno", descricao: "Estrutura padrão que uso para laudos de consulta de retorno.",
    tags: ["laudo", "template"], ias: ["assistente_ai"], ativo: true, status: "pronto",
    itens: [{ id: uid(), tipo: "texto", nome: "Modelo de laudo (texto colado)", tokens: 340 }],
  },
];

const DEFAULT_ATALHOS = [
  { id: uid(), atalho: "/resumo-retorno", texto: "Gere um resumo objetivo da consulta de retorno em tópicos: queixa atual, evolução desde a última consulta, conduta e próximos passos.", ias: ["chat_ai", "assistente_ai"] },
  { id: uid(), atalho: "/orientacoes-has", texto: "Escreva orientações claras para o paciente sobre hipertensão: alimentação, atividade física, adesão medicamentosa e sinais de alerta.", ias: ["chat_ai"] },
];

/* ---------- main component ---------- */
export default function BaseConhecimento() {
  const [tab, setTab] = useState("bases");
  const [bases, setBases] = useState(DEFAULT_BASES);
  const [atalhos, setAtalhos] = useState(DEFAULT_ATALHOS);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  // carregar do storage persistente
  useEffect(() => {
    (async () => {
      try {
        const b = await window.storage.get("kb:bases");
        if (b?.value) setBases(JSON.parse(b.value));
      } catch (_) {}
      try {
        const a = await window.storage.get("kb:atalhos");
        if (a?.value) setAtalhos(JSON.parse(a.value));
      } catch (_) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) persist("kb:bases", bases); }, [bases, loaded]);
  useEffect(() => { if (loaded) persist("kb:atalhos", atalhos); }, [atalhos, loaded]);

  async function persist(key, value) {
    try { await window.storage.set(key, JSON.stringify(value)); } catch (_) {}
  }

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden" style={{ background: pageBackground, fontFamily: pageFont }}>
      <Blob className="bg-emerald-200" style={{ width: 420, height: 420, top: -120, left: -120 }} />
      <Blob className="bg-violet-200" style={{ width: 380, height: 380, top: 160, right: -160 }} />
      <Blob className="bg-amber-200" style={{ width: 300, height: 300, bottom: -100, left: "40%" }} />

      <div className="relative max-w-4xl mx-auto px-5 md:px-8 py-8 pb-28">
        {/* header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div className="flex items-start gap-4">
            <div style={iconBoxRadius} className="w-14 h-14 flex items-center justify-center shrink-0 bg-gradient-to-br from-violet-400 to-violet-600 shadow-lg shadow-violet-200">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Base de conhecimento</h1>
              <p className="text-sm text-slate-500 mt-1 max-w-lg">
                Alimente o Chat IA e o Assistente IA com seus próprios arquivos, textos e atalhos de comando.
              </p>
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="inline-flex p-1 mb-6 bg-white/60 backdrop-blur-xl border border-white/80 rounded-full shadow-sm">
          {[
            { id: "bases", label: "Bases de conhecimento", icon: BookOpen },
            { id: "atalhos", label: "Atalhos de comando", icon: Zap },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                tab === t.id ? "bg-white text-violet-600 shadow" : "text-slate-500 hover:text-slate-700"
              }`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* info card sobre como funciona */}
        <div className={`${card} mb-6`} style={cardRadius}>
          <div className="flex items-start gap-4">
            <div style={iconBoxRadius} className="w-11 h-11 flex items-center justify-center shrink-0 bg-gradient-to-br from-sky-400 to-blue-500">
              <Info className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-800">Como a IA usa isso: </span>
              quando o tópico da pergunta bate com uma base ativa, a IA prioriza esse conteúdo e avisa que a resposta
              veio da <span className="text-emerald-600 font-medium">sua base local</span>. Quando não há base
              suficiente, ela recorre ao conhecimento geral e avisa que{" "}
              <span className="text-slate-700 font-medium">não é uma base local</span>.
            </div>
          </div>
        </div>

        {tab === "bases" ? (
          <BasesTab bases={bases} setBases={setBases} showToast={showToast} />
        ) : (
          <AtalhosTab atalhos={atalhos} setAtalhos={setAtalhos} showToast={showToast} />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-30" style={{ borderRadius: "999px" }}>
          <div style={{ borderRadius: "999px" }} className="bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 shadow-lg shadow-emerald-300/50 flex items-center gap-2">
            <Check className="w-4 h-4" /> {toast}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Bases tab ---------- */
function BasesTab({ bases, setBases, showToast }) {
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  function addBase(novaBase) {
    setBases((prev) => [{ ...novaBase, id: uid(), status: "pronto" }, ...prev]);
    setCreating(false);
    showToast("Base de conhecimento criada");
  }
  function updateBase(id, patch) {
    setBases((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeBase(id) {
    setBases((prev) => prev.filter((b) => b.id !== id));
    showToast("Base removida");
  }

  return (
    <div className="flex flex-col gap-4">
      {bases.map((base) => (
        <BaseCard
          key={base.id}
          base={base}
          open={openId === base.id}
          onToggleOpen={() => setOpenId(openId === base.id ? null : base.id)}
          onUpdate={(patch) => updateBase(base.id, patch)}
          onRemove={() => removeBase(base.id)}
          showToast={showToast}
        />
      ))}

      {creating ? (
        <NewBaseForm onCancel={() => setCreating(false)} onSave={addBase} />
      ) : (
        <button onClick={() => setCreating(true)}
          className="flex items-center justify-center gap-2 py-4 rounded-3xl border-2 border-dashed border-violet-200 text-violet-600 text-sm font-medium hover:border-violet-400 hover:bg-white/40 transition-all">
          <Plus className="w-4 h-4" /> Nova base de conhecimento
        </button>
      )}
    </div>
  );
}

function BaseCard({ base, open, onToggleOpen, onUpdate, onRemove, showToast }) {
  const totalTokens = base.itens.reduce((s, i) => s + (i.tokens || 0), 0);
  const fileInputRef = useRef(null);

  function handleFiles(fileList) {
    const novos = Array.from(fileList).map((f) => ({
      id: uid(), tipo: "arquivo", nome: f.name, tokens: estimateTokens("x".repeat(Math.min(f.size, 20000))),
    }));
    onUpdate({ itens: [...base.itens, ...novos] });
    showToast(`${novos.length} arquivo(s) adicionado(s)`);
  }

  function removeItem(itemId) {
    onUpdate({ itens: base.itens.filter((i) => i.id !== itemId) });
  }

  return (
    <div className={card} style={cardRadius}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <button onClick={onToggleOpen} className="flex items-start gap-4 text-left flex-1 min-w-[240px]">
          <div style={iconBoxRadius} className={`w-12 h-12 flex items-center justify-center shrink-0 bg-gradient-to-br ${base.ativo ? "from-emerald-400 to-emerald-600" : "from-slate-300 to-slate-400"}`}>
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-800">{base.nome}</h3>
              {!base.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-medium">inativa</span>}
            </div>
            <p className="text-sm text-slate-500 mt-0.5 max-w-xl">{base.descricao}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {base.tags.map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100 flex items-center gap-1">
                  <Tag className="w-2.5 h-2.5" /> {t}
                </span>
              ))}
              {base.ias.map((iaId) => {
                const ia = IA_OPTIONS.find((o) => o.id === iaId);
                if (!ia) return null;
                return (
                  <span key={iaId} className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 border ${ia.color === "violet" ? "bg-violet-50 text-violet-600 border-violet-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"}`}>
                    <ia.icon className="w-2.5 h-2.5" /> {ia.label}
                  </span>
                );
              })}
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                ~{fmtTokens(totalTokens)} tokens · {base.itens.length} item(ns)
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <Toggle checked={base.ativo} onChange={() => onUpdate({ ativo: !base.ativo })} />
          <button onClick={onRemove} className="text-slate-400 hover:text-rose-500 transition-colors p-1.5">
            <Trash2 className="w-4 h-4" />
          </button>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} onClick={onToggleOpen} />
        </div>
      </div>

      {open && (
        <div className="mt-6 pt-6 border-t border-slate-200/70">
          <div className="flex flex-col gap-2 mb-4">
            {base.itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-white/70 border border-slate-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-700 truncate">{item.nome}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">~{fmtTokens(item.tokens)} tok</span>
                </div>
                <button onClick={() => removeItem(item.id)} className="text-slate-300 hover:text-rose-500 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {base.itens.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum arquivo ou texto ainda.</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/80 border border-slate-200 text-sm text-slate-600 hover:border-emerald-300 transition-colors">
              <Upload className="w-4 h-4" /> Enviar arquivo
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
            <AddTextButton onAdd={(nome, texto) => onUpdate({ itens: [...base.itens, { id: uid(), tipo: "texto", nome, tokens: estimateTokens(texto) }] })} />
          </div>
        </div>
      )}
    </div>
  );
}

function AddTextButton({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/80 border border-slate-200 text-sm text-slate-600 hover:border-violet-300 transition-colors">
        <FileUp className="w-4 h-4" /> Colar texto
      </button>
    );
  }
  return (
    <div className="w-full mt-2 p-4 rounded-2xl bg-white/70 border border-slate-100">
      <input className={inputCls + " mb-2"} placeholder="Título do texto (ex: Observações sobre dose)" value={nome} onChange={(e) => setNome(e.target.value)} />
      <textarea className={inputCls} rows={4} placeholder="Cole aqui o conteúdo..." value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-slate-500">Cancelar</button>
        <button
          onClick={() => { if (nome.trim() && texto.trim()) { onAdd(nome.trim(), texto.trim()); setNome(""); setTexto(""); setOpen(false); } }}
          className="px-4 py-1.5 rounded-full bg-violet-500 text-white text-xs font-medium hover:bg-violet-600">
          Adicionar
        </button>
      </div>
    </div>
  );
}

function NewBaseForm({ onCancel, onSave }) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [ias, setIas] = useState(["chat_ai", "assistente_ai"]);

  function toggleIa(id) {
    setIas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function save() {
    if (!nome.trim()) return;
    onSave({
      nome: nome.trim(),
      descricao: descricao.trim() || "Sem descrição.",
      tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
      ias, ativo: true, itens: [],
    });
  }

  return (
    <div className={card} style={cardRadius}>
      <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <Plus className="w-4 h-4 text-violet-500" /> Nova base de conhecimento
      </h3>
      <Field label="Nome do tópico" hint="Curto e específico — é o que ajuda a IA a reconhecer o assunto.">
        <input className={inputCls} placeholder="Ex: Protocolo de enxaqueca da clínica" value={nome} onChange={(e) => setNome(e.target.value)} />
      </Field>
      <Field label="Descrição" hint="Um resumo de 1-2 frases. É sempre enviado à IA para ela saber que essa base existe.">
        <textarea className={inputCls} rows={2} placeholder="Do que se trata essa base..." value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </Field>
      <Field label="Tags" hint="Separadas por vírgula.">
        <input className={inputCls} placeholder="cardiologia, protocolo" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
      </Field>
      <Field label="Usar em">
        <div className="flex gap-2">
          {IA_OPTIONS.map((ia) => (
            <Chip key={ia.id} active={ias.includes(ia.id)} onClick={() => toggleIa(ia.id)} color={ia.color}>{ia.label}</Chip>
          ))}
        </div>
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500">Cancelar</button>
        <button onClick={save} className="px-5 py-2 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-violet-200">
          Criar base
        </button>
      </div>
    </div>
  );
}

/* ---------- Atalhos tab ---------- */
function AtalhosTab({ atalhos, setAtalhos, showToast }) {
  const [creating, setCreating] = useState(false);

  function addAtalho(novo) {
    setAtalhos((prev) => [{ ...novo, id: uid() }, ...prev]);
    setCreating(false);
    showToast("Atalho criado");
  }
  function removeAtalho(id) {
    setAtalhos((prev) => prev.filter((a) => a.id !== id));
    showToast("Atalho removido");
  }

  return (
    <div className="flex flex-col gap-3">
      {atalhos.map((a) => (
        <div key={a.id} className={card} style={cardRadius}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div style={iconBoxRadius} className="w-11 h-11 flex items-center justify-center shrink-0 bg-gradient-to-br from-amber-400 to-orange-500">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <code className="text-sm font-semibold text-slate-800 bg-amber-50 px-2 py-0.5 rounded-md">{a.atalho}</code>
                <p className="text-sm text-slate-500 mt-1.5 line-clamp-2">{a.texto}</p>
                <div className="flex gap-1.5 mt-2">
                  {a.ias.map((iaId) => {
                    const ia = IA_OPTIONS.find((o) => o.id === iaId);
                    if (!ia) return null;
                    return (
                      <span key={iaId} className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 border ${ia.color === "violet" ? "bg-violet-50 text-violet-600 border-violet-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"}`}>
                        <ia.icon className="w-2.5 h-2.5" /> {ia.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <button onClick={() => removeAtalho(a.id)} className="text-slate-400 hover:text-rose-500 transition-colors p-1.5 shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}

      {creating ? (
        <NewAtalhoForm onCancel={() => setCreating(false)} onSave={addAtalho} />
      ) : (
        <button onClick={() => setCreating(true)}
          className="flex items-center justify-center gap-2 py-4 rounded-3xl border-2 border-dashed border-amber-200 text-amber-600 text-sm font-medium hover:border-amber-400 hover:bg-white/40 transition-all">
          <Plus className="w-4 h-4" /> Novo atalho de comando
        </button>
      )}
    </div>
  );
}

function NewAtalhoForm({ onCancel, onSave }) {
  const [atalho, setAtalho] = useState("/");
  const [texto, setTexto] = useState("");
  const [ias, setIas] = useState(["chat_ai", "assistente_ai"]);

  function toggleIa(id) {
    setIas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function save() {
    if (!atalho.trim().startsWith("/") || !texto.trim()) return;
    onSave({ atalho: atalho.trim(), texto: texto.trim(), ias });
  }

  return (
    <div className={card} style={cardRadius}>
      <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <Plus className="w-4 h-4 text-amber-500" /> Novo atalho
      </h3>
      <Field label="Atalho" hint="Precisa começar com '/'. É isso que você digita no chat.">
        <input className={inputCls} placeholder="/resumo-retorno" value={atalho} onChange={(e) => setAtalho(e.target.value)} />
      </Field>
      <Field label="Comando completo" hint="Texto que substitui o atalho ao enviar a mensagem.">
        <textarea className={inputCls} rows={3} placeholder="Escreva o comando completo..." value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Field>
      <Field label="Disponível em">
        <div className="flex gap-2">
          {IA_OPTIONS.map((ia) => (
            <Chip key={ia.id} active={ias.includes(ia.id)} onClick={() => toggleIa(ia.id)} color={ia.color}>{ia.label}</Chip>
          ))}
        </div>
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500">Cancelar</button>
        <button onClick={save} className="px-5 py-2 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white text-sm font-semibold shadow-lg shadow-amber-200">
          Criar atalho
        </button>
      </div>
    </div>
  );
}
