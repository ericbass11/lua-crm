"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface ClearHistoryArgs {
  conversation_id: string;
}

interface ClearHistoryResponse {
  data: { cleared: boolean; messages_deleted: number };
}

/** Apaga todas as mensagens da conversa no CRM (admin). Zera a "memória" da IA na thread. */
export function useClearHistory() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ClearHistoryArgs) =>
      apiClient.post<ClearHistoryResponse>(
        `/api/v1/conversations/${args.conversation_id}/clear-history`,
        {},
      ),
    onError: (err) => {
      showApiError(err);
    },
    onSuccess: (res, args) => {
      toast.success(`Histórico limpo (${res.data.messages_deleted} mensagens).`);
      qc.invalidateQueries({ queryKey: ["messages", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
