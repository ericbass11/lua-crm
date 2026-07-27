"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface Settings {
  handoff_webhook_url: string | null;
  handoff_whatsapp_number: string | null;
  handoff_enabled: boolean;
}

export function HandoffWebhookCard() {
  const [url, setUrl] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiClient.get<{ data: Settings }>("/api/v1/settings/notifications");
        setUrl(res.data.handoff_webhook_url ?? "");
        setWhatsapp(res.data.handoff_whatsapp_number ?? "");
        setEnabled(res.data.handoff_enabled);
      } catch (err) {
        showApiError(err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch("/api/v1/settings/notifications", {
        handoff_webhook_url: url.trim(),
        handoff_whatsapp_number: whatsapp.trim(),
        handoff_enabled: enabled,
      });
      toast.success("Alerta de handoff salvo.");
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Alerta de atendimento humano</h2>
          <p className="mt-1 text-sm text-text-muted">
            Quando a IA passa uma conversa para um humano, o time é avisado neste webhook. Funciona
            com Slack, Discord, n8n ou qualquer endpoint — o payload traz o motivo, o contato e o
            link da conversa.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!loaded} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="handoff-whatsapp">WhatsApp do time</Label>
        <Input
          id="handoff-whatsapp"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="55DDDNÚMERO (separe vários por vírgula)"
          disabled={!loaded}
        />
        <p className="text-xs text-text-muted">
          Recebe o alerta pelo próprio número do negócio (WhatsApp), com motivo, resumo e link.
          Ex.: <code>5531999998888</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-url">Webhook (opcional)</Label>
        <Input
          id="handoff-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (Slack / Discord / n8n / custom)"
          disabled={!loaded}
        />
        <p className="text-xs text-text-muted">
          Alternativa ou complemento ao WhatsApp. Dica: aponte para um fluxo do n8n e roteie para
          Telegram, e-mail, etc.
        </p>
      </div>
      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving || !loaded}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </Card>
  );
}
