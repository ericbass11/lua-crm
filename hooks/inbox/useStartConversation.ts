"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface StartConversationArgs {
  phone_number: string;
  message: string;
  contact_name?: string;
  channel_session_id?: string;
}

export interface StartConversationResult {
  conversation_id: string;
  contact_id: string;
  message_id: string;
  message_status: string;
  lead_created: boolean;
  lead_id: string | null;
}

/**
 * Envio ativo: cria/resolve a conversa com um número novo, envia a 1ª mensagem
 * e adiciona o contato ao funil padrão (POST /api/v1/conversations).
 * Ao concluir, invalida as listas de inbox e o board do kanban.
 */
export function useStartConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: StartConversationArgs) => {
      const res = await apiClient.post<{ data: StartConversationResult }>(
        "/api/v1/conversations",
        input,
      );
      return res.data;
    },
    onError: (err) => {
      showApiError(err);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}
