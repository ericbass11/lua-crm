/**
 * GET /api/v1/auth/realtime-token — devolve o access_token da PRÓPRIA sessão
 * do chamador, para autenticar o Supabase Realtime no browser.
 *
 * Por quê: o cookie de auth é HttpOnly (decisão de segurança correta), então
 * o supabase-js do browser não tem sessão — toda subscription postgres_changes
 * nascia com role 'anon' e a RLS filtrava 100% dos eventos silenciosamente
 * (inbox/kanban só atualizavam no F5). O servidor lê o cookie HttpOnly e
 * entrega o token ao dono da sessão via rota autenticada same-origin.
 *
 * Segurança: getUser() valida o JWT antes (doutrina); o token retornado é o
 * do próprio usuário — mesma credencial que o browser usaria se o cookie não
 * fosse HttpOnly. Nunca em query string; nunca cacheável.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return fail("unauthenticated", "Auth required.", 401, { requestId });

  // getSession aqui é seguro: getUser() acima já validou o JWT no servidor;
  // só precisamos do access_token bruto que veio do cookie.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return fail("unauthenticated", "Sessão não encontrada.", 401, { requestId });
  }

  return new Response(
    JSON.stringify({
      data: { access_token: session.access_token, expires_at: session.expires_at ?? null },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
        "X-Request-Id": requestId,
      },
    },
  );
}
