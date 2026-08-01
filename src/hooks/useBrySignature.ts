import { useCallback, useEffect, useRef, useState } from "react";
import {
  bryService,
  type BrySignature,
  type BrySignatureStatus,
  type CreateEnvelopeParams,
} from "@/services/bry";

const POLL_MS = 5000;
const FINAL: BrySignatureStatus[] = ["SIGNED", "EXPIRED", "CANCELLED", "REJECTED"];

export interface UseBrySignature {
  signature: BrySignature | null;
  status: BrySignatureStatus | null;
  signUrl: string | null;
  fileUrl: string | null;
  loading: boolean;
  error: string | null;
  sign: (params: CreateEnvelopeParams) => Promise<string | null>;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useBrySignature(initialId?: string | null): UseBrySignature {
  const [id, setId] = useState<string | null>(initialId ?? null);
  const [signature, setSignature] = useState<BrySignature | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const { signature: row } = await bryService.getEnvelope(id);
      setSignature(row);
      if (row.status === "SIGNED" && !archivedRef.current) {
        archivedRef.current = true;
        try {
          const done = await bryService.downloadDocument(id);
          setSignature(done.signature);
          setFileUrl(done.file_url);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  // Poll while pending so the UI updates itself after the patient signs.
  useEffect(() => {
    if (!id) return;
    let active = true;
    void refresh();
    const timer = setInterval(() => {
      if (!active) return;
      if (signature && FINAL.includes(signature.status)) return;
      void refresh();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, refresh, signature]);

  const sign = useCallback(async (params: CreateEnvelopeParams) => {
    setLoading(true);
    setError(null);
    setFileUrl(null);
    archivedRef.current = false;
    try {
      const created = await bryService.createEnvelope(params);
      setId(created.id);
      return created.sign_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { signature: row } = await bryService.cancelEnvelope(id);
      setSignature(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const reset = useCallback(() => {
    setId(null);
    setSignature(null);
    setFileUrl(null);
    setError(null);
    archivedRef.current = false;
  }, []);

  return {
    signature,
    status: signature?.status ?? null,
    signUrl: signature?.sign_url ?? null,
    fileUrl,
    loading,
    error,
    sign,
    refresh,
    cancel,
    reset,
  };
}