"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useStartConversation } from "@/hooks/inbox/useStartConversation";
import { normalizeToE164 } from "@/lib/phone";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Chamado com o id da conversa criada, para abri-la no chat. */
  onCreated: (conversationId: string) => void;
}

export function NewConversationDialog({ open, onOpenChange, onCreated }: Props) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const channelsQ = useChannelSessions({ enabled: open });
  const workingChannels = useMemo(
    () => (channelsQ.data ?? []).filter((c) => c.status === "WORKING"),
    [channelsQ.data],
  );
  const start = useStartConversation();

  useEffect(() => {
    if (open) {
      setPhone("");
      setName("");
      setMessage("");
      setChannelId(undefined);
      setError(null);
    }
  }, [open]);

  const phonePreview = useMemo(() => normalizeToE164(phone)?.e164 ?? null, [phone]);
  const needsChannelChoice = workingChannels.length > 1;

  function channelLabel(c: (typeof workingChannels)[number]): string {
    return c.display_name || c.phone_number || c.waha_session_name;
  }

  async function onSubmit() {
    setError(null);
    if (!phonePreview) {
      setError("Número de telefone inválido. Use DDD + número (ex.: 11 99999-9999).");
      return;
    }
    if (!message.trim()) {
      setError("Escreva a mensagem que será enviada.");
      return;
    }
    if (workingChannels.length === 0) {
      setError("Nenhum número de WhatsApp conectado. Conecte um canal em Conexões.");
      return;
    }
    if (needsChannelChoice && !channelId) {
      setError("Escolha por qual número enviar.");
      return;
    }

    try {
      const res = await start.mutateAsync({
        phone_number: phone,
        message: message.trim(),
        contact_name: name.trim() || undefined,
        channel_session_id: needsChannelChoice ? channelId : (channelId ?? workingChannels[0]?.id),
      });
      toast.success(
        res.lead_created ? "Conversa iniciada e lead adicionado ao funil." : "Conversa iniciada.",
      );
      onOpenChange(false);
      onCreated(res.conversation_id);
    } catch {
      // useStartConversation já mostra o toast de erro da API.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Envie uma mensagem ativa por WhatsApp. O contato é adicionado automaticamente ao funil
            padrão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nc-phone">Número do WhatsApp</Label>
            <Input
              id="nc-phone"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
            {phonePreview && (
              <p className="text-xs text-muted-foreground">Enviando para {phonePreview}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nc-name">Nome do contato (opcional)</Label>
            <Input
              id="nc-name"
              placeholder="Ex.: João Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {needsChannelChoice && (
            <div className="space-y-1.5">
              <Label htmlFor="nc-channel">Enviar pelo número</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="nc-channel">
                  <SelectValue placeholder="Escolha o canal" />
                </SelectTrigger>
                <SelectContent>
                  {workingChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {channelLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nc-message">Mensagem</Label>
            <Textarea
              id="nc-message"
              rows={3}
              placeholder="Escreva a primeira mensagem…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-error-fg">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={start.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={onSubmit} disabled={start.isPending}>
            {start.isPending ? "Enviando…" : "Enviar mensagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
