-- =============================================================================
-- 0034_handoff_whatsapp
-- Alerta de handoff também por WhatsApp: número(s) destino que recebem a
-- notificação (motivo + link + resumo) enviada pelo número do negócio (WAHA).
-- Idempotente.
-- =============================================================================
alter table public.notification_settings
  add column if not exists handoff_whatsapp_number text;
