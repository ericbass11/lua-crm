"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * O cookie de auth é HttpOnly → o supabase-js do browser NÃO tem sessão e
 * assinaria tudo como 'anon' (RLS filtra 100% dos eventos, silenciosamente).
 * Este endpoint devolve o access_token da própria sessão via cookie HttpOnly.
 */
async function fetchRealtimeToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/auth/realtime-token", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { access_token?: string } };
    return json.data?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Renova o token do canal antes do JWT (1h) expirar. */
const TOKEN_REFRESH_MS = 30 * 60 * 1000;

export type RealtimeStatus =
  | "connecting"
  | "subscribed"
  | "channel_error"
  | "timed_out"
  | "closed";

export interface UseRealtimeChannelOpts {
  name: string;
  postgresChanges?: {
    event: "INSERT" | "UPDATE" | "DELETE" | "*";
    schema?: string;
    table: string;
    filter?: string;
  };
  broadcast?: { event: string };
  onChange: (payload: unknown) => void;
  enabled?: boolean;
}

export function useRealtimeChannel(opts: UseRealtimeChannelOpts): { status: RealtimeStatus } {
  const { name, postgresChanges, broadcast, onChange, enabled = true } = opts;

  // ref makes onChange identity-stable so changing handler doesn't re-subscribe
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "closed");

  // React 19 strict mode mounts effects twice in dev. If two consumers ever
  // share the same logical channel name (or the same component re-mounts),
  // Supabase reuses the existing channel object — calling `.on()` after the
  // prior `.subscribe()` errors out. Append a stable per-instance suffix so
  // every hook call owns its own channel topology.
  const instanceId = useId();

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }
    const supabase = createClient();
    const channelName = `${name}::${instanceId}`;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const handler = (payload: unknown) => {
      onChangeRef.current(payload);
    };

    setStatus("connecting");
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    // CRÍTICO: autenticar o socket ANTES de assinar — e o token vem do
    // ENDPOINT (cookie HttpOnly: getSession() no browser retorna null!).
    // claims_role da subscription tem que ser 'authenticated', senão o
    // walrus aplica RLS como 'anon' e filtra todos os eventos.
    void (async () => {
      const token =
        (await fetchRealtimeToken()) ??
        // fallback: deployments com cookie legível pelo JS
        (await supabase.auth.getSession()).data.session?.access_token ??
        null;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      // JWT expira em 1h — renova o auth do socket (atualiza canais já
      // assinados) antes disso, senão o realtime morre silenciosamente.
      refreshTimer = setInterval(() => {
        void (async () => {
          const fresh = await fetchRealtimeToken();
          if (fresh) await supabase.realtime.setAuth(fresh);
        })();
      }, TOKEN_REFRESH_MS);

      channel = supabase.channel(channelName);

      if (postgresChanges) {
        channel = channel.on(
          "postgres_changes",
          {
            event: postgresChanges.event,
            schema: postgresChanges.schema ?? "public",
            table: postgresChanges.table,
            ...(postgresChanges.filter ? { filter: postgresChanges.filter } : {}),
          },
          handler,
        );
      }

      if (broadcast) {
        channel = channel.on("broadcast", { event: broadcast.event }, handler);
      }

      channel.subscribe((s) => {
        // s is one of "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"
        const map: Record<string, RealtimeStatus> = {
          SUBSCRIBED: "subscribed",
          CHANNEL_ERROR: "channel_error",
          TIMED_OUT: "timed_out",
          CLOSED: "closed",
        };
        setStatus(map[s] ?? "connecting");
      });
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
    // intentionally omit onChange (ref); only re-subscribe when channel topology changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, enabled, instanceId, postgresChanges?.event, postgresChanges?.table, postgresChanges?.filter, postgresChanges?.schema, broadcast?.event]);

  return { status };
}
