import { cn } from "@/lib/utils";
import type { BrySignatureStatus } from "@/services/bry";

export interface SignatureStatusProps {
  status: BrySignatureStatus | null;
  error?: string | null;
  loading?: boolean;
  signUrl?: string | null;
  fileUrl?: string | null;
  onCancel?: () => void;
  className?: string;
}

const LABELS: Record<BrySignatureStatus, { title: string; hint: string; tone: string }> = {
  PENDING: {
    title: "Aguardando assinatura",
    hint: "O documento foi enviado para assinatura.",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  SIGNED: {
    title: "Documento assinado",
    hint: "A assinatura foi concluída e o arquivo está disponível.",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  EXPIRED: {
    title: "Prazo expirado",
    hint: "O envelope de assinatura expirou. Gere um novo documento.",
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  CANCELLED: {
    title: "Assinatura cancelada",
    hint: "O envelope foi cancelado.",
    tone: "border-muted bg-muted text-muted-foreground",
  },
  REJECTED: {
    title: "Assinatura recusada",
    hint: "O signatário recusou assinar o documento.",
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

export function SignatureStatus({
  status,
  error,
  loading,
  signUrl,
  fileUrl,
  onCancel,
  className,
}: SignatureStatusProps) {
  if (error) {
    return (
      <div
        role="status"
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive",
          className,
        )}
      >
        <p className="font-medium">Erro na assinatura</p>
        <p className="opacity-80">{error}</p>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div
        role="status"
        className={cn("rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground", className)}
      >
        Enviando documento para assinatura...
      </div>
    );
  }

  if (!status) return null;
  const info = LABELS[status];

  return (
    <div role="status" className={cn("rounded-lg border p-3 text-sm", info.tone, className)}>
      <p className="font-medium">{info.title}</p>
      <p className="opacity-80">{info.hint}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {status === "PENDING" && signUrl ? (
          <a className="underline" href={signUrl} target="_blank" rel="noreferrer">
            Abrir assinatura
          </a>
        ) : null}
        {status === "SIGNED" && fileUrl ? (
          <a className="underline" href={fileUrl} target="_blank" rel="noreferrer">
            Baixar PDF assinado
          </a>
        ) : null}
        {status === "PENDING" && onCancel ? (
          <button type="button" className="underline" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default SignatureStatus;